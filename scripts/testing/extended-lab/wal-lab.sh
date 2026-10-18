#!/usr/bin/env bash
# Actual backup and WAL replay against disposable S3, never production storage.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 64
[[ "$IOT_COMPOSE_PROJECT" == "iot-manager-eight-$GITHUB_RUN_ID" ]] || exit 64
root="$(pwd)"
lab="$root/deploy/.runtime/$IOT_COMPOSE_PROJECT/physical-lab"
mkdir -p "$lab"
export IOT_RECOVERY_PROJECT="iot-manager-lab-pitr-$GITHUB_RUN_ID"
export IOT_RECOVERY_REPORT_DIR="$lab/evidence"
export IOT_RECOVERY_TIMEOUT_SECONDS=300 IOT_WAL_ARCHIVE_TIMEOUT_SECONDS=180
export IOT_RECOVERY_TARGET_NAME=lab_validation IOT_RECOVERY_BASE_BACKUP=base_validation
export IOT_PITR_CONFIRM=PITR
# Keep cleanup Compose configuration valid even if fixture startup fails.
cat >> "$IOT_ENVIRONMENT_FILE" <<EOF
WALG_STORAGE_MODE=s3
WALG_S3_PREFIX=s3://iot-isolated-lab/$GITHUB_RUN_ID
AWS_ENDPOINT=http://lab-s3:9000
AWS_REGION=us-east-1
AWS_S3_FORCE_PATH_STYLE=true
EOF
s3_name="iot-manager-lab-s3-$GITHUB_RUN_ID"
recovery_network="${IOT_RECOVERY_PROJECT}_egress"
source=(compose --project-name "$IOT_COMPOSE_PROJECT" --env-file "$IOT_ENVIRONMENT_FILE" -f deploy/docker-compose.yml)
recovery=(compose --project-name "$IOT_RECOVERY_PROJECT" --env-file "$IOT_ENVIRONMENT_FILE" -f deploy/docker-compose.yml -f deploy/docker-compose.recovery.yml)
finish() {
  local result=$? cleanup=true
  trap - EXIT
  set +e
  if (( result != 0 )); then
    docker "${recovery[@]}" logs --no-color --tail 80 wal-g-recovery postgres > "$lab/failure.log" 2>&1
    tail -n 60 "$lab/failure.log"
  fi
  docker "${recovery[@]}" down --remove-orphans --volumes > "$lab/cleanup.log" 2>&1 || cleanup=false
  if docker container inspect "$s3_name" >/dev/null 2>&1; then docker rm -f "$s3_name" >/dev/null || cleanup=false; fi
  if docker network inspect "$recovery_network" >/dev/null 2>&1; then docker network rm "$recovery_network" >/dev/null || cleanup=false; fi
  test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$IOT_RECOVERY_PROJECT")" || cleanup=false
  test -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$IOT_RECOVERY_PROJECT")" || cleanup=false
  LAB_RESULT="$result" LAB_CLEANUP="$cleanup" LAB_REPORT="$IOT_RECOVERY_REPORT_DIR/report.json" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
let report = null;
try { report = JSON.parse(readFileSync(process.env.LAB_REPORT, 'utf8')); } catch {}
const passed = process.env.LAB_RESULT === '0' && process.env.LAB_CLEANUP === 'true' && report?.status === 'passed';
writeFileSync(process.env.IOT_EIGHT_ROOT + '/physical-lab.json', JSON.stringify({passed,
  sourceSha: process.env.GITHUB_SHA, productionApproved: false, storage: 'disposable Moto S3 API fixture',
  productionStorageTested: false, cleanupPassed: process.env.LAB_CLEANUP === 'true', report}, null, 2) + '\n');
NODE
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
"$RUNNER_TEMP/s3-client/bin/python" - <<'PY'
import boto3, os
from pathlib import Path
root = Path(os.environ['IOT_SECRET_DIR'])
s3 = boto3.client('s3', endpoint_url='http://127.0.0.1:19000', region_name='us-east-1',
    aws_access_key_id=(root/'walg_s3_access_key').read_text().strip(),
    aws_secret_access_key=(root/'walg_s3_secret_key').read_text().strip())
s3.create_bucket(Bucket='iot-isolated-lab')
PY
docker network create --label "com.docker.compose.project=$IOT_RECOVERY_PROJECT" \
  --label com.docker.compose.network=egress "$recovery_network" >/dev/null
docker network connect --alias lab-s3 "$recovery_network" "$s3_name"
docker "${source[@]}" --profile application up -d --no-build --no-deps wal-g-archive wal-g-backup
bash scripts/runtime/wal-recovery-drill.sh
