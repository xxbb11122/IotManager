#!/usr/bin/env bash
# A disposable, digest-bound logical migration; never accepts a production volume.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 64
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || exit 64
out=artifacts/simulation/postgres-abi
mkdir -p "$out"
manifest=artifacts/release/image-digests.json
new_image="$(node scripts/ci/release-tools.mjs list-digest-artifacts --manifest "$manifest" | awk -F '\t' '$1 == "IMG-R04" {print $2}')"
client_image="$(node scripts/ci/release-tools.mjs list-digest-artifacts --manifest "$manifest" | awk -F '\t' '$1 == "IMG-R07" {print $2}')"
# The previously tested PG16/glibc candidate, including the same vector 0.8.6 extension.
old_image=ghcr.io/xxbb11122/iot-manager-postgres:sha-0811f80ac849@sha256:6e55d9e27a184d2a08a2b6bb9e00236e98e706af799394b6de338e9995a555f4
for image in "$new_image" "$client_image" "$old_image"; do
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || exit 64
  docker pull "$image"
done
project="iot-pg-abi-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
old="$project-old"
new="$project-new"
rejected="$project-refused"
owner="iot.abi.lab=$project"
cleanup() {
  local status=$?
  trap - EXIT
  for name in "$old" "$new" "$rejected"; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      test "$(docker inspect --format '{{index .Config.Labels "iot.abi.lab"}}' "$name")" = "$project" || exit 70
      docker rm -f "$name" >/dev/null || exit 70
    fi
  done
  for volume in "$old" "$new"; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      test "$(docker volume inspect --format '{{index .Labels "iot.abi.lab"}}' "$volume")" = "$project" || exit 70
      docker volume rm "$volume" >/dev/null || exit 70
    fi
  done
  if docker network inspect "$project" >/dev/null 2>&1; then
    test "$(docker network inspect --format '{{index .Labels "iot.abi.lab"}}' "$project")" = "$project" || exit 70
    docker network rm "$project" >/dev/null || exit 70
  fi
  printf '{"passed":true,"ownedResourcesRemaining":0}\n' > "$out/cleanup.json"
  exit "$status"
}
trap cleanup EXIT
# Resource creation fails on collisions; cleanup only accepts our exact label.
docker network create --internal --label "$owner" "$project" >/dev/null
for volume in "$old" "$new"; do
  docker volume create --label "$owner" "$volume" >/dev/null
  docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
    --entrypoint /bin/sh -v "$volume:/data" "$new_image" -ec \
    'test -z "$(ls -A /data)"; chown 999:999 /data; chmod 0700 /data'
done
start_database() {
  local name=$1 image=$2
  docker run -d --name "$name" --label "$owner" --network "$project" --network-alias "$name" \
    --user 999:999 --cap-drop ALL --security-opt no-new-privileges:true \
    -e POSTGRES_DB=migration -e POSTGRES_PASSWORD=isolated-abi-fixture-only \
    -e 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C' \
    -v "$name:/var/lib/postgresql/data" "$image" >/dev/null
  for attempt in $(seq 1 90); do
    if docker exec "$name" pg_isready -U postgres -d migration >/dev/null 2>&1; then return; fi
    sleep 1
  done
  docker logs "$name" > "$out/$name.log" 2>&1
  return 1
}
sql() { docker exec -i "$1" psql -X -U postgres -d migration -v ON_ERROR_STOP=1 -At; }
start_database "$old" "$old_image"
sql "$old" <<'SQL'
CREATE EXTENSION vector;
CREATE TABLE migration_probe(id bigint PRIMARY KEY, label text NOT NULL, at timestamptz NOT NULL,
  payload jsonb NOT NULL, embedding vector(3) NOT NULL);
INSERT INTO migration_probe SELECT n, '设备/温度/É/🚀-' || n,
  '2026-10-20T00:00:00+08:00'::timestamptz + n * interval '1 second',
  jsonb_build_object('site', '模拟迁移', 'n', n), '[1,2,3]'::vector FROM generate_series(1,300) n;
CREATE INDEX migration_probe_vector ON migration_probe USING hnsw (embedding vector_l2_ops);
SQL
fingerprint_sql="SELECT count(*) || ':' || md5(string_agg(id::text || label || (at AT TIME ZONE 'UTC')::text || payload::text || embedding::text, E'\\n' ORDER BY id)) FROM migration_probe;"
printf '%s\n' "$fingerprint_sql" | sql "$old" > "$out/source-fingerprint.txt"
docker run --rm --network "$project" --read-only --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m -e PGPASSWORD=isolated-abi-fixture-only \
  --entrypoint pg_dump "$client_image" -h "$old" -U postgres -d migration \
  --format=custom --no-owner --no-acl > "$out/migration.dump"
test -s "$out/migration.dump"
sha256sum "$out/migration.dump" > "$out/dump.sha256"
docker stop "$old" >/dev/null
volume_fingerprint() {
  docker run --rm --network none --read-only --cap-drop ALL --user 999:999 \
    --entrypoint /bin/sh -v "$old:/data:ro" "$new_image" -ec \
    'test ! -e /data/.iot-runtime-abi; sha256sum /data/PG_VERSION /data/global/pg_control'
}
volume_fingerprint > "$out/old-volume-before.txt"
set +e
docker run --name "$rejected" --label "$owner" --network none --user 999:999 --cap-drop ALL \
  -v "$old:/var/lib/postgresql/data" "$new_image" postgres > "$out/old-volume-refused.txt" 2>&1
refused_exit=$?
set -e
test "$refused_exit" -eq 78
grep -Fq 'Refusing PostgreSQL startup' "$out/old-volume-refused.txt"
volume_fingerprint > "$out/old-volume-after.txt"
cmp "$out/old-volume-before.txt" "$out/old-volume-after.txt"
start_database "$new" "$new_image"
docker exec "$new" cat /var/lib/postgresql/data/.iot-runtime-abi > "$out/new-runtime-abi.txt"
grep -Fxq pg16-musl-alpine3.24-v1 "$out/new-runtime-abi.txt"
docker run --rm -i --network "$project" --read-only --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m -e PGPASSWORD=isolated-abi-fixture-only \
  --entrypoint pg_restore "$client_image" -h "$new" -U postgres -d migration \
  --exit-on-error --no-owner --no-acl < "$out/migration.dump"
printf '%s\n' "$fingerprint_sql" | sql "$new" > "$out/target-fingerprint.txt"
cmp "$out/source-fingerprint.txt" "$out/target-fingerprint.txt"
sql "$new" <<'SQL' > "$out/extension-and-write.txt"
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SELECT count(*) FROM pg_index WHERE indrelid = 'migration_probe'::regclass AND indisvalid;
INSERT INTO migration_probe VALUES (301, '迁移后可写', now(), '{"ok":true}', '[1,2,3]');
SELECT count(*) FROM migration_probe;
SELECT id FROM migration_probe ORDER BY embedding <-> '[1,2,3]'::vector, id LIMIT 1;
SQL
grep -Fxq 0.8.6 "$out/extension-and-write.txt"
grep -Fxq 2 "$out/extension-and-write.txt"
grep -Fxq 301 "$out/extension-and-write.txt"
grep -Fxq 1 "$out/extension-and-write.txt"
# The guarded cluster must also survive a normal restart after initialization.
docker restart "$new" >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$new" pg_isready -U postgres -d migration >/dev/null 2>&1; then break; fi
  sleep 1
done
test "$(printf 'SELECT count(*) FROM migration_probe;\n' | sql "$new")" = 301
export ABI_OLD_IMAGE="$old_image" ABI_NEW_IMAGE="$new_image" ABI_CLIENT_IMAGE="$client_image"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const raw=fs.readFileSync('artifacts/release/image-digests.json');
const manifest=JSON.parse(raw);
fs.writeFileSync('artifacts/simulation/postgres-abi/summary.json',JSON.stringify({
  passed:true,productionApproved:false,sourceSha:manifest.sourceSha,
  candidateId:manifest.releaseCandidateId,manifestSha256:crypto.createHash('sha256').update(raw).digest('hex'),
  sourceImage:process.env.ABI_OLD_IMAGE,targetImage:process.env.ABI_NEW_IMAGE,clientImage:process.env.ABI_CLIENT_IMAGE,
  checks:['Unknown glibc volume refused with exit 78 without changing PG_VERSION/pg_control',
    'Fresh musl volume initialized with its own ABI marker',
    'Actual PG16 dump/restore preserves 300 Unicode/JSON/timestamptz/vector rows',
    'Vector 0.8.6 index restored and usable; post-migration write and restart passed'],
  boundaries:['Synthetic isolated data, no production volume','Application cutover still requires a verified logical migration and a new backup chain']
},null,2)+'\n');
NODE
