#!/usr/bin/env bash
# Exercises the real operational tools with synthetic data and disposable S3.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || exit 64
root="$(pwd)"
project="iot-ops-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
export IOT_PG_MIGRATION_CONFIRM="$project"
private="$RUNNER_TEMP/$project"
mkdir -m 0700 "$private"
out="$root/artifacts/release-ops"
mkdir -p "$out"
cp deploy/.env.example "$private/source.env"
export IOT_SECRET_DIR="$private/secrets"
bash scripts/runtime/new-secrets.sh "$IOT_SECRET_DIR" > /dev/null
cat >> "$private/source.env" <<EOF
POSTGRES_BOOTSTRAP_USERNAME=lab_admin
IOT_SECRET_DIR=$IOT_SECRET_DIR
IOT_MIGRATION_INITDB_ARGS=--encoding=UTF8 --locale=C
WALG_S3_PREFIX=s3://iot-ops/new-$project
AWS_ENDPOINT=http://ops-s3:9000
EOF
release="$root/artifacts/ops-release"
node scripts/ci/release-tools.mjs render-digest-env --manifest "$release/image-digests.json" --output "$release/image-digests.env" >/dev/null
image="$(node scripts/ci/release-tools.mjs list-digest-artifacts --manifest "$release/image-digests.json" | awk -F '\t' '$1=="IMG-R04"{print $2}')"
init_image="$(node scripts/ci/release-tools.mjs list-digest-artifacts --manifest "$release/image-digests.json" | awk -F '\t' '$1=="IMG-R08"{print $2}')"
for selected_image in "$image" "$init_image"; do docker pull "$selected_image" >/dev/null; done
compose=(docker compose --project-name "$project" --env-file "$private/source.env" --env-file "$release/image-digests.env" -f deploy/docker-compose.yml -f deploy/docker-compose.immutable.yml)
recovery="iot-manager-migration-$project"
fixture="$project-legacy:lab"
cleanup() {
  local status=$? remaining=0
  trap - EXIT
  set +e
  # Every resource below belongs to a unique current run/attempt label.
  for scope in "$project" "$recovery"; do
    for kind in container volume network; do
      local ids
      case "$kind" in
        container) ids="$(docker ps -aq --filter "label=com.docker.compose.project=$scope")" ;;
        volume) ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$scope")" ;;
        network) ids="$(docker network ls -q --filter "label=com.docker.compose.project=$scope")" ;;
      esac
      for owned in $ids; do
        if [[ "$kind" == container ]]; then docker rm -f "$owned" >/dev/null || remaining=1;
        else docker "$kind" rm "$owned" >/dev/null || remaining=1; fi
      done
    done
  done
  if docker image inspect "$fixture" >/dev/null 2>&1; then
    [[ "$(docker image inspect --format '{{index .Config.Labels "iot.ops.lab"}}' "$fixture")" == "$project" ]] && docker image rm "$fixture" >/dev/null || remaining=1
  fi
  for scope in "$project" "$recovery"; do
    [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$scope")$(docker volume ls -q --filter "label=com.docker.compose.project=$scope")$(docker network ls -q --filter "label=com.docker.compose.project=$scope")" ]] || remaining=1
  done
  printf '{"status":%s,"ownedResourcesRemaining":%s}\n' "$status" "$remaining" > "$out/cleanup.json"
  [[ "$remaining" == 0 ]] || status=1
  exit "$status"
}
trap cleanup EXIT
"${compose[@]}" -f deploy/docker-compose.migration.yml up -d --no-build postgres > "$private/start.log" 2>&1
for attempt in $(seq 1 120); do
  target="$("${compose[@]}" ps -q postgres)"
  if [[ -n "$target" && "$(docker inspect --format '{{.State.Health.Status}}' "$target")" == healthy ]]; then break; fi
  sleep 1
done
[[ -n "$target" && "$(docker inspect --format '{{.State.Health.Status}}' "$target")" == healthy ]]
docker build --label "iot.ops.lab=$project" -f scripts/testing/postgres-abi/legacy-fixture.Dockerfile -t "$fixture" . > "$private/fixture-build.log" 2>&1
docker volume create --label "com.docker.compose.project=$project" "$project-old-data" >/dev/null
docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
 --entrypoint /bin/sh -v "$project-old-data:/data" "$image" -ec 'chmod 0700 /data; chown 999:999 /data'
docker run -d --name "$project-old" --label "com.docker.compose.project=$project" --network "${project}_internal" --user 999:999 \
 --cap-drop ALL -e POSTGRES_USER=lab_admin -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_admin_password \
 -e 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C' -e IOT_DB_DATABASE=iot_manager -e IOT_DB_OWNER_USERNAME=iot_manager_owner \
 -e IOT_DB_USERNAME=iot_manager_app -e KEYCLOAK_DB_DATABASE=keycloak -e KEYCLOAK_DB_USERNAME=keycloak \
 -v "$project-old-data:/var/lib/postgresql/data" -v "${project}_runtime-secrets-postgres:/run/secrets:ro" \
 -v "$root/deploy/postgres/init-databases.sh:/docker-entrypoint-initdb.d/10-init-databases.sh:ro" "$fixture" >/dev/null
for attempt in $(seq 1 120); do
 if docker exec "$project-old" pg_isready -h 127.0.0.1 -U lab_admin -d iot_manager >/dev/null 2>&1; then break; fi
 sleep 1
done
docker exec "$project-old" psql -U lab_admin -d iot_manager -Atc "SELECT extversion FROM pg_extension WHERE extname='vector'" | grep -Fxq 0.8.6
# Explicit evidence source fixture, not an unchanged historical image.
docker image inspect --format '{{.Id}}' "$fixture" > "$out/legacy-fixture-image.txt"
docker exec -i "$project-old" psql -X -v ON_ERROR_STOP=1 -U lab_admin -d iot_manager <<'SQL' > /dev/null
SET ROLE iot_manager_owner;
CREATE TABLE migration_probe(id bigserial PRIMARY KEY,label text NOT NULL,at timestamptz,payload jsonb,embedding vector(3));
INSERT INTO migration_probe(label,at,payload,embedding) SELECT '设备/温度/É/🚀-'||n,'2026-10-21T00:00:00+08:00'::timestamptz+n*interval '1 second',jsonb_build_object('n',n),'[1,2,3]'::vector FROM generate_series(1,300) n;
CREATE INDEX probe_vector ON migration_probe USING hnsw(embedding vector_l2_ops);
CREATE TABLE flyway_schema_history(installed_rank integer PRIMARY KEY,version varchar,success boolean);
INSERT INTO flyway_schema_history VALUES(1,'28',true);
CREATE FUNCTION probe_label(bigint) RETURNS text LANGUAGE sql STABLE AS 'SELECT label FROM migration_probe WHERE id=$1';
REVOKE EXECUTE ON FUNCTION probe_label(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION probe_label(bigint) TO iot_manager_app;
RESET ROLE;
SELECT lo_from_bytea(0,decode('001122aabbcc','hex'));
SQL
docker exec -i "$project-old" psql -X -v ON_ERROR_STOP=1 -U lab_admin -d keycloak <<'SQL' >/dev/null
SET ROLE keycloak;
CREATE TABLE auth_probe(id integer PRIMARY KEY,username text);
INSERT INTO auth_probe SELECT n,'模拟用户-'||n FROM generate_series(1,20) n;
SQL
export OPS_SOURCE="$project-old" OPS_TARGET="$target" OPS_IMAGE="$image" OPS_PRIVATE="$private" OPS_PROJECT="$project"
node --input-type=module <<'NODE'
import {writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const config={id:process.env.OPS_PROJECT,adminUser:'lab_admin',sourceContainer:process.env.OPS_SOURCE,targetContainer:process.env.OPS_TARGET,
 sourceImageId:JSON.parse(execFileSync('docker',['inspect',process.env.OPS_SOURCE]))[0].Image,targetImage:process.env.OPS_IMAGE,
 databases:['iot_manager','keycloak'],oldBackupPrefix:'s3://iot-ops/old-'+process.env.OPS_PROJECT,newBackupPrefix:'s3://iot-ops/new-'+process.env.OPS_PROJECT};
writeFileSync(process.env.OPS_PRIVATE+'/migration-config.json',JSON.stringify(config),{mode:0o600});
NODE
tool=(node scripts/ops/postgres-migrate.mjs)
common=(--config "$private/migration-config.json" --directory "$private/export")
"${tool[@]}" inspect "${common[@]}" > "$private/inventory.json"
"${tool[@]}" export "${common[@]}" --output "$out/export.json"
cp "$private/export/iot_manager.dump" "$private/original.dump"
printf 'tampered' >> "$private/export/iot_manager.dump"
if "${tool[@]}" restore "${common[@]}" > "$private/tamper-rejection.log" 2>&1; then exit 1; fi
grep -Fq 'Dump checksum mismatch' "$private/tamper-rejection.log"
cp "$private/original.dump" "$private/export/iot_manager.dump"
docker exec "$target" psql -U lab_admin -d postgres -c 'GRANT iot_manager_owner TO iot_manager_app' >/dev/null
if "${tool[@]}" restore "${common[@]}" > "$private/role-rejection.log" 2>&1; then exit 1; fi
grep -Fq 'matching least-privilege roles' "$private/role-rejection.log"
docker exec "$target" psql -U lab_admin -d postgres -c 'REVOKE iot_manager_owner FROM iot_manager_app' >/dev/null
"${tool[@]}" restore "${common[@]}" --output "$out/restore.json"
if "${tool[@]}" restore "${common[@]}" > "$private/repeat-rejection.log" 2>&1; then exit 1; fi
grep -Fq 'Target database must be empty' "$private/repeat-rejection.log"
"${tool[@]}" verify "${common[@]}" --output "$out/verify.json"
docker exec "$target" psql -U lab_admin -d iot_manager -c "UPDATE migration_probe SET label='corrupted-target' WHERE id=1" >/dev/null
if "${tool[@]}" verify "${common[@]}" > "$private/data-rejection.log" 2>&1; then exit 1; fi
grep -Fq 'Database data' "$private/data-rejection.log"
docker exec "$target" psql -U lab_admin -d iot_manager -c "UPDATE migration_probe SET label='设备/温度/É/🚀-1' WHERE id=1" >/dev/null
"${tool[@]}" verify "${common[@]}" > /dev/null
# Real SDK data-role read/write and DDL-denial checks on the migrated cluster.
docker exec "$target" psql -U lab_admin -d iot_manager -v ON_ERROR_STOP=1 -c 'SET ROLE iot_manager_app; SELECT probe_label(1); INSERT INTO migration_probe(label) VALUES('\''权限写入验证'\''); DELETE FROM migration_probe WHERE label='\''权限写入验证'\'';' > "$out/app-permissions.txt"
# The write proof advances the sequence, so re-export to a new evidence state is
# intentionally required before a production backup handoff. Reset lab sequence.
docker exec "$target" psql -U lab_admin -d iot_manager -Atc "SELECT setval('migration_probe_id_seq',300,true)" >/dev/null
if docker exec "$target" psql -U lab_admin -d iot_manager -v ON_ERROR_STOP=1 -c 'SET ROLE iot_manager_app; CREATE TABLE forbidden(id integer)' > "$private/ddl-rejection.log" 2>&1; then exit 1; fi
docker network create --label "com.docker.compose.project=$project" --label com.docker.compose.network=egress "${project}_egress" >/dev/null
docker run -d --name "$project-s3" --label "com.docker.compose.project=$project" --network "${project}_egress" --network-alias ops-s3 \
 -p 127.0.0.1:19090:9000 -e MOTO_PORT=9000 -e S3_IGNORE_SUBDOMAIN_BUCKETNAME=true \
 motoserver/moto:5.1.14@sha256:800719627036dc38dc699e9f314f624f2c98ac3d8bb754db078cb2698f08ee77 >/dev/null
for attempt in $(seq 1 60); do if curl --fail --silent http://127.0.0.1:19090/ >/dev/null; then break; fi; sleep 1; done
curl --fail --silent -X PUT http://127.0.0.1:19090/iot-ops >/dev/null
docker network create --label "com.docker.compose.project=$recovery" --label com.docker.compose.network=egress "${recovery}_egress" >/dev/null
docker network connect --alias ops-s3 "${recovery}_egress" "$project-s3"
"${compose[@]}" --profile application up -d --no-build --no-deps wal-g-archive > "$private/archive.log" 2>&1
node scripts/ops/backup-migrated-database.mjs run --config "$private/migration-config.json" --directory "$private/export" \
 --project "$project" --env-file "$private/source.env" --release "$release" --output "$out/new-chain" > "$out/new-chain-summary.json"
printf '{"status":"PASS","productionApproved":false,"data":"300 vector rows, 20 auth rows, sequence and large object","negativeCases":["tampered dump","role escalation","repeat restore","target data corruption","app DDL denial"],"sourceFixture":"portable pgvector rebuild on pinned historical glibc base","newChain":"actual full backup and WAL replay on isolated Moto S3"}\n' > "$out/summary.json"
