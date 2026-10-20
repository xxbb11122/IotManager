#!/usr/bin/env bash
# Disposable S3 and synthetic data only. Does not create formal stage evidence.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 64
[[ "$IOT_COMPOSE_PROJECT" == "iot-manager-immutable-sim-$GITHUB_RUN_ID" ]] || exit 64
root="$(pwd)"
export IOT_ENVIRONMENT_FILE="$root/deploy/.env.integration"
export IOT_SECRET_DIR="$root/deploy/.runtime/$IOT_COMPOSE_PROJECT/secrets"
lab="$root/deploy/.runtime/$IOT_COMPOSE_PROJECT/recovery-lab"
out="$root/artifacts/simulation/physical"
mkdir -p "$lab" "$out"
first="iot-manager-immutable-pitr-$GITHUB_RUN_ID"
second="$first-after-cleanup"
bad="$first-bad-metadata"
projects=("$first" "$second" "$bad")
s3_name="iot-immutable-s3-$GITHUB_RUN_ID"
export IOT_RECOVERY_TIMEOUT_SECONDS=180 IOT_WAL_ARCHIVE_TIMEOUT_SECONDS=180
export IOT_RECOVERY_TARGET_NAME=simulation_validation IOT_RECOVERY_BASE_BACKUP=base_validation
cp "$IOT_ENVIRONMENT_FILE" "$lab/original.env"
cat >> "$IOT_ENVIRONMENT_FILE" <<EOF
WALG_STORAGE_MODE=s3
WALG_S3_PREFIX=s3://iot-isolated-lab/$GITHUB_RUN_ID
AWS_ENDPOINT=http://lab-s3:9000
AWS_REGION=us-east-1
AWS_S3_FORCE_PATH_STYLE=true
EOF
source_compose=(compose --project-name "$IOT_COMPOSE_PROJECT" --profile application --profile observability
  --env-file "$IOT_ENVIRONMENT_FILE" --env-file "deploy/.runtime/$IOT_COMPOSE_PROJECT/runtime.env"
  --env-file artifacts/release/image-digests.env -f deploy/docker-compose.yml
  -f deploy/docker-compose.integration.yml -f deploy/docker-compose.immutable.yml)
recovery_compose() {
  docker compose --project-name "$1" --env-file "$IOT_ENVIRONMENT_FILE" --env-file artifacts/release/image-digests.env \
    -f deploy/docker-compose.yml -f deploy/docker-compose.recovery.yml -f deploy/docker-compose.immutable.yml \
    -f deploy/docker-compose.immutable.recovery.yml "${@:2}"
}
finish() {
  local result=$? cleanup=true
  trap - EXIT
  set +e
  if docker container inspect "$s3_name" >/dev/null 2>&1; then
    if [[ "$(docker inspect --format '{{index .Config.Labels "iot.lab.run"}}' "$s3_name")" == "$GITHUB_RUN_ID" ]]; then
      docker rm -f "$s3_name" >/dev/null || cleanup=false
    else cleanup=false; fi
  fi
  for project in "${projects[@]}"; do
    recovery_compose "$project" logs --no-color --tail 50 wal-g-recovery postgres > "$out/$project.log" 2>&1
    recovery_compose "$project" down --volumes --remove-orphans > "$lab/$project-cleanup.log" 2>&1 || cleanup=false
    test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" || cleanup=false
    test -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" || cleanup=false
  done
  for project in "${projects[@]}"; do
    if docker network inspect "${project}_egress" >/dev/null 2>&1; then docker network rm "${project}_egress" >/dev/null || cleanup=false; fi
  done
  cp "$lab/original.env" "$IOT_ENVIRONMENT_FILE" || cleanup=false
  printf '{"passed":%s,"containersRemaining":0,"volumesRemaining":0}\n' "$cleanup" > "$out/cleanup.json"
  [[ "$cleanup" == true ]] || result=1
  exit "$result"
}
trap finish EXIT

docker run -d --name "$s3_name" --network "${IOT_COMPOSE_PROJECT}_egress" --network-alias lab-s3 \
  --label "iot.lab.run=$GITHUB_RUN_ID" -p 127.0.0.1:19000:9000 -e MOTO_PORT=9000 \
  -e S3_IGNORE_SUBDOMAIN_BUCKETNAME=true \
  motoserver/moto:5.1.14@sha256:800719627036dc38dc699e9f314f624f2c98ac3d8bb754db078cb2698f08ee77 >/dev/null
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:19000/ >/dev/null; then break; fi
  sleep 1
done
python3 -m venv "$lab/python"
"$lab/python/bin/pip" --quiet install boto3==1.40.43
export LAB_PRIVATE="$lab" LAB_PUBLIC="$out"
cat > "$lab/s3.py" <<'PY'
import boto3, os, json, sys
from pathlib import Path
private=Path(os.environ['LAB_PRIVATE'])
secrets=Path(os.environ['IOT_SECRET_DIR'])
s3=boto3.client('s3',endpoint_url='http://127.0.0.1:19000',region_name='us-east-1',
 aws_access_key_id=(secrets/'walg_s3_access_key').read_text().strip(),
 aws_secret_access_key=(secrets/'walg_s3_secret_key').read_text().strip())
if sys.argv[1]=='create': s3.create_bucket(Bucket='iot-isolated-lab')
else:
 saved=private/'sentinel.json'
 if sys.argv[1]=='corrupt':
  report=json.loads((Path(os.environ['LAB_PUBLIC'])/'baseline'/'report.json').read_text())
  keys=s3.list_objects_v2(Bucket='iot-isolated-lab',Prefix=os.environ['GITHUB_RUN_ID']+'/basebackups_005/').get('Contents',[])
  matches=[v['Key'] for v in keys if report['baseBackup'] in v['Key'] and v['Key'].endswith('backup_stop_sentinel.json')]
  assert len(matches)==1, matches
  key=matches[0]; saved.write_bytes(s3.get_object(Bucket='iot-isolated-lab',Key=key)['Body'].read())
  (private/'sentinel-key.txt').write_text(key)
  s3.put_object(Bucket='iot-isolated-lab',Key=key,Body=b'invalid-simulation-json')
 else: s3.put_object(Bucket='iot-isolated-lab',Key=(private/'sentinel-key.txt').read_text(),Body=saved.read_bytes())
PY
"$lab/python/bin/python" "$lab/s3.py" create
for project in "${projects[@]}"; do
  docker network create --label "com.docker.compose.project=$project" --label com.docker.compose.network=egress "${project}_egress" >/dev/null
  docker network connect --alias lab-s3 "${project}_egress" "$s3_name"
done
docker "${source_compose[@]}" up -d --no-build --no-deps wal-g-archive wal-g-backup
pg_id="$(docker "${source_compose[@]}" ps -q postgres)"
admin="$(sed -n 's/^POSTGRES_BOOTSTRAP_USERNAME=//p' "$IOT_ENVIRONMENT_FILE" | tail -n1)"
database="$(sed -n 's/^IOT_DB_DATABASE=//p' "$IOT_ENVIRONMENT_FILE" | tail -n1)"
owner="$(sed -n 's/^IOT_DB_OWNER_USERNAME=//p' "$IOT_ENVIRONMENT_FILE" | tail -n1)"
docker exec -i -u postgres "$pg_id" psql -U "$admin" -d "$database" -v ON_ERROR_STOP=1 -v owner="$owner" <<'SQL'
CREATE SCHEMA remaining_simulation AUTHORIZATION :"owner";
CREATE TABLE remaining_simulation.payload (id integer PRIMARY KEY, body text NOT NULL);
ALTER TABLE remaining_simulation.payload OWNER TO :"owner";
INSERT INTO remaining_simulation.payload
SELECT i, string_agg(md5(random()::text || j::text), '')
FROM generate_series(1,32768) i CROSS JOIN generate_series(1,64) j GROUP BY i;
CHECKPOINT;
SQL
fingerprint="SELECT count(*) || '|' || sum(octet_length(body)) || '|' || md5(string_agg(md5(body),'' ORDER BY id)) FROM remaining_simulation.payload"
docker exec -u postgres "$pg_id" psql -U "$admin" -d "$database" -Atc "$fingerprint" > "$out/original-data.txt"
export IOT_RECOVERY_PROJECT="$first" IOT_RECOVERY_REPORT_DIR="$out/baseline"
IOT_PITR_CONFIRM=PITR bash scripts/runtime/wal-recovery-drill.sh --mode immutable \
  --digest-manifest artifacts/release/image-digests.json --digest-env-file artifacts/release/image-digests.env \
  --release-services artifacts/release/release-services.json --release-candidate artifacts/release/release-candidate.json \
  --release-topology artifacts/release/release-topology.json

# Delete the synthetic source data after the backup/restore point, then restore
# a second fresh database from that retained backup. No production data exists.
docker exec -u postgres "$pg_id" psql -U "$admin" -d "$database" -v ON_ERROR_STOP=1 \
  -c 'TRUNCATE remaining_simulation.payload; CHECKPOINT' >/dev/null
test "$(docker exec -u postgres "$pg_id" psql -U "$admin" -d "$database" -Atc 'SELECT count(*) FROM remaining_simulation.payload')" = 0
export IOT_RECOVERY_BASE_BACKUP="$(node -p "require('./artifacts/simulation/physical/baseline/report.json').baseBackup")"
export IOT_RECOVERY_TARGET_NAME="$(node -p "require('./artifacts/simulation/physical/baseline/report.json').recoveryTargetName")"
started="$(node -p 'process.hrtime.bigint().toString()')"
recovery_compose "$second" up -d --no-build volume-init wal-g-recovery postgres
deadline=$((SECONDS+180))
while true; do
  recovered="$(recovery_compose "$second" ps -q postgres)"
  if [[ -n "$recovered" && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$recovered")" == healthy ]]; then break; fi
  (( SECONDS < deadline )) || exit 1
  sleep 2
done
docker exec -u postgres "$recovered" psql -U "$admin" -d "$database" -Atc "$fingerprint" > "$out/restored-after-cleanup-data.txt"
cmp "$out/original-data.txt" "$out/restored-after-cleanup-data.txt"
finished="$(node -p 'process.hrtime.bigint().toString()')"
START_NS="$started" END_NS="$finished" node --input-type=module <<'NODE'
import fs from 'node:fs';
const [rows,bytes,fingerprint]=fs.readFileSync('artifacts/simulation/physical/original-data.txt','utf8').trim().split('|');
fs.writeFileSync('artifacts/simulation/physical/cleanup-then-pitr.json',JSON.stringify({passed:true,productionApproved:false,
  rows:Number(rows),logicalPayloadBytes:Number(bytes),fingerprint,sourceRowsAfterCleanup:0,
  restoredRows:Number(rows),databaseRestoreSeconds:Number(BigInt(process.env.END_NS)-BigInt(process.env.START_NS))/1e9,
  boundaries:['64 MiB synthetic payload and disposable Moto S3; not an approved production data-size or storage-IAM test']},null,2)+'\n');
NODE
node scripts/ci/release-tools.mjs verify-service-digests --phase recovery --project "$second" \
  --env "$IOT_ENVIRONMENT_FILE" --image-env artifacts/release/image-digests.env --base-compose deploy/docker-compose.yml \
  --recovery-compose deploy/docker-compose.recovery.yml --immutable-compose deploy/docker-compose.immutable.yml \
  --immutable-compose deploy/docker-compose.immutable.recovery.yml --services artifacts/release/release-services.json \
  --manifest artifacts/release/image-digests.json --output "$out/recovery-service-digests.json"
node scripts/ci/release-tools.mjs aggregate-service-digests --candidate artifacts/release/release-candidate.json \
  --services artifacts/release/release-services.json --manifest artifacts/release/image-digests.json \
  --runtime-evidence artifacts/simulation/runtime-service-digests.json --recovery-evidence "$out/recovery-service-digests.json" \
  --output "$out/union-service-digests.json"

# An existing recovery volume and a damaged backup sentinel must fail closed.
export IOT_RECOVERY_PROJECT="$second"
if IOT_PITR_CONFIRM=PITR bash scripts/runtime/wal-recovery-drill.sh --mode immutable \
  --digest-manifest artifacts/release/image-digests.json --digest-env-file artifacts/release/image-digests.env \
  --release-services artifacts/release/release-services.json > "$out/existing-target-rejection.log" 2>&1; then exit 1; fi
grep -Fq 'Refusing physical recovery because target volume already exists' "$out/existing-target-rejection.log"
"$lab/python/bin/python" "$lab/s3.py" corrupt
if timeout 90s bash -c 'docker compose --project-name "$1" --env-file "$IOT_ENVIRONMENT_FILE" --env-file artifacts/release/image-digests.env -f deploy/docker-compose.yml -f deploy/docker-compose.recovery.yml -f deploy/docker-compose.immutable.yml -f deploy/docker-compose.immutable.recovery.yml up -d --no-build volume-init wal-g-recovery postgres' _ "$bad" > "$out/corrupt-backup-rejection.log" 2>&1; then exit 1; fi
recovery_compose "$bad" logs --no-color wal-g-recovery >> "$out/corrupt-backup-rejection.log" 2>&1
grep -Eiq 'invalid character|unmarshal|unexpected EOF|invalid.*json' "$out/corrupt-backup-rejection.log"
"$lab/python/bin/python" "$lab/s3.py" restore
printf '{"passed":true,"existingTargetRejected":true,"corruptBackupRejected":true,"productionApproved":false}\n' > "$out/negative-results.json"
