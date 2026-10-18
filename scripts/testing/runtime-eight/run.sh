#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repository_root"
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || {
  echo 'Use an ephemeral GitHub Actions runner for this isolated drill.' >&2; exit 64;
}
export IOT_COMPOSE_PROJECT="iot-manager-eight-$GITHUB_RUN_ID"
export IOT_EIGHT_ROOT="$repository_root/artifacts/runtime-eight"
export IOT_EIGHT_TOOLS="$repository_root/scripts/testing/runtime-eight"
export IOT_ENVIRONMENT_FILE="$repository_root/deploy/.runtime/$IOT_COMPOSE_PROJECT/integration.env"
export IOT_RUNTIME_STATE_FILE="$repository_root/deploy/.runtime/$IOT_COMPOSE_PROJECT/runtime.env"
export IOT_SECRET_DIR="$repository_root/deploy/.runtime/$IOT_COMPOSE_PROJECT/secrets"
export IOT_RUNTIME_BASE_URL=https://iot-manager.localhost
export IOT_ENABLE_OBSERVABILITY=false
export IOT_RUNTIME_TIMEOUT_SECONDS=300
node "$IOT_EIGHT_TOOLS/prepare.mjs"

compose=(compose --project-name "$IOT_COMPOSE_PROJECT" --profile application
  --env-file "$IOT_ENVIRONMENT_FILE" --env-file "$IOT_RUNTIME_STATE_FILE"
  -f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")
mode=base
active_compose() {
  case "$mode" in
    base) docker "${compose[@]}" "$@" ;;
    ai) docker "${compose[@]}" -f "$IOT_EIGHT_TOOLS/compose-ai.yml" "$@" ;;
    rollback) docker "${compose[@]}" -f "$IOT_EIGHT_TOOLS/compose-ai.yml" -f "$IOT_EIGHT_ROOT/compose-rollback.yml" "$@" ;;
  esac
}
finish() {
  local result=$? cleanup_ok=true containers=unknown volumes=unknown
  trap - EXIT
  set +e
  if (( result != 0 )) && [[ -f "$IOT_RUNTIME_STATE_FILE" ]]; then
    export IOT_DIAGNOSTIC_DIRECTORY="$IOT_EIGHT_ROOT/diagnostics"
    bash scripts/runtime/collect-runtime-diagnostics.sh >/dev/null 2>&1
  fi
  # Never remove containers or volumes outside this job's explicit project.
  if [[ "$IOT_COMPOSE_PROJECT" =~ ^iot-manager-eight-[0-9]+$ && -f "$IOT_RUNTIME_STATE_FILE" ]]; then
    active_compose down --remove-orphans --volumes >/dev/null 2>&1 || cleanup_ok=false
    containers="$(docker ps -aq --filter "label=com.docker.compose.project=$IOT_COMPOSE_PROJECT" | wc -l)"
    volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=$IOT_COMPOSE_PROJECT" | wc -l)"
    [[ "$containers" == 0 && "$volumes" == 0 ]] || cleanup_ok=false
  else
    cleanup_ok=false
  fi
  CLEANUP_PASSED="$cleanup_ok" CLEANUP_CONTAINERS="$containers" CLEANUP_VOLUMES="$volumes" node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.IOT_EIGHT_ROOT + '/cleanup.json', JSON.stringify({ passed: process.env.CLEANUP_PASSED === 'true',
  containersRemaining: process.env.CLEANUP_CONTAINERS, volumesRemaining: process.env.CLEANUP_VOLUMES }, null, 2));
NODE
  node "$IOT_EIGHT_TOOLS/summarize.mjs" || result=1
  exit "$result"
}
trap finish EXIT

docker info >/dev/null
if ss -H -ltn | awk '$4 ~ /:(80|443)$/ { occupied=1 } END { exit !occupied }'; then
  echo 'The isolated runner requires free ports 80 and 443.' >&2; exit 69;
fi
bash scripts/runtime/new-secrets.sh "$IOT_SECRET_DIR"
printf '%s' test-only-key > "$IOT_SECRET_DIR/ai_chat_api_key"
chmod 600 "$IOT_SECRET_DIR/ai_chat_api_key"
bash scripts/runtime/start-integration.sh
echo '::notice title=Runtime ready::Isolated database, Keycloak, Backend and Caddy are healthy.'

for role in OWNER ADMIN OPERATOR VIEWER; do
  lower="${role,,}"
  password="$(cat "$IOT_SECRET_DIR/keycloak_${lower}_password")"
  printf '::add-mask::%s\n' "$password"
  export "IOT_E2E_${role}_USERNAME=integration-$lower"
  export "IOT_E2E_${role}_PASSWORD=$password"
done
unset password
active_compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$IOT_EIGHT_ROOT/root.crt"
export NODE_EXTRA_CA_CERTS="$IOT_EIGHT_ROOT/root.crt"
export IOT_RUNTIME_CA_CERTIFICATE="$IOT_EIGHT_ROOT/root.crt"
nss_directory="$HOME/.pki/nssdb"
mkdir -p "$nss_directory"
[[ -f "$nss_directory/cert9.db" ]] || certutil -d "sql:$nss_directory" -N --empty-password
certutil -d "sql:$nss_directory" -A -t 'C,,' -n runtime-eight -i "$IOT_EIGHT_ROOT/root.crt"
run_tests() {
  export IOT_EIGHT_PHASE="$1"; shift
  (cd "$repository_root/apps/client-glass-next" && npx playwright test --config "$IOT_EIGHT_TOOLS/playwright.config.mjs" "$@")
}
wait_backend() {
  for attempt in $(seq 1 100); do
    id="$(active_compose ps -q backend)"
    if [[ -n "$id" && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")" == healthy ]]; then return; fi
    sleep 3
  done
  echo 'Backend did not become healthy in 300 seconds.' >&2; return 1
}

echo 'R03-R07: real Keycloak, API, RBAC and TLS WebSockets'
run_tests auth "$repository_root/apps/client-glass-next/e2e/runtime-auth.spec.js"
echo '::notice title=R03-R07 passed::Five real-service authentication, RBAC and credential scenarios passed.'

echo 'R02: real Backend with an internal HTTPS AI fixture'
javac -d "$IOT_EIGHT_ROOT" "$IOT_EIGHT_TOOLS/JvmZoneProbe.java"
keytool -importcert -noprompt -alias runtime-eight -file "$IOT_EIGHT_ROOT/root.crt" \
  -keystore "$IOT_EIGHT_ROOT/fixture.p12" -storetype PKCS12 -storepass changeit
chmod 644 "$IOT_EIGHT_ROOT/fixture.p12"
mode=ai
active_compose up -d --no-build --no-deps ai-fixture caddy
active_compose up -d --no-build --no-deps backend
wait_backend
curl --fail --silent --show-error --cacert "$IOT_EIGHT_ROOT/root.crt" \
  --resolve ai-fixture.test:443:127.0.0.1 https://ai-fixture.test/__evidence >/dev/null
export IOT_EIGHT_AI_FIXTURE=true
run_tests ai "$IOT_EIGHT_TOOLS/ai-provider.spec.mjs"
active_compose exec -T ai-fixture node -e 'fetch("http://127.0.0.1:8081/__evidence").then(r=>r.text()).then(t=>process.stdout.write(t))' > "$IOT_EIGHT_ROOT/ai-evidence.json"
echo '::notice title=R02 passed::The real Backend and internal HTTPS AI fixture completed the chat test.'

echo 'R08: 1000 virtual devices, 100 real authenticated WebSockets'
export IOT_LOAD_SIMULATION_DEVICES=1000 IOT_LOAD_SIMULATION_WEBSOCKETS=100 IOT_LOAD_SIMULATION_CONCURRENCY=25
export IOT_LOAD_SIMULATION_EVIDENCE="$IOT_EIGHT_ROOT/load-evidence.json"
run_tests load "$repository_root/apps/client-glass-next/e2e/runtime-load.spec.js"
echo '::notice title=R08 passed::1000 devices and 100 authenticated WebSockets passed, including data cleanup.'

echo 'R01: actual N-to-N-1 Backend switch with the same database'
baseline=e0977e77220773182df4e3a73741686cbb87c6d9
git cat-file -e "$baseline^{commit}"
mkdir -p "$IOT_EIGHT_ROOT/n-minus-one"
git archive "$baseline" backend profiles deploy/Dockerfile | tar -x -C "$IOT_EIGHT_ROOT/n-minus-one"
docker build --build-arg "BACKEND_SOURCE_REVISION=$baseline" --label "org.opencontainers.image.revision=$baseline" \
  -t "iot-manager-eight-n1:$GITHUB_RUN_ID" -f "$IOT_EIGHT_ROOT/n-minus-one/deploy/Dockerfile" "$IOT_EIGHT_ROOT/n-minus-one"
export IOT_ROLLBACK_MARKER="rollback-eight-$GITHUB_RUN_ID" IOT_ROLLBACK_PHASE=write
run_tests rollback-write "$repository_root/apps/client-glass-next/e2e/rollback-data-compatibility.spec.js"
export EIGHT_DB_BEFORE="$(active_compose ps -q postgres)"
export EIGHT_N_IMAGE="$(docker inspect --format '{{.Image}}' "$(active_compose ps -q backend)")"
node "$IOT_EIGHT_TOOLS/snapshot-runtime.mjs" n "$(active_compose ps -q backend)"
active_compose exec -T postgres application-role-psql.sh -v ON_ERROR_STOP=1 -t -A \
  -c 'SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank' > "$IOT_EIGHT_ROOT/migrations-before.txt"
active_compose exec -T postgres application-role-psql.sh -v ON_ERROR_STOP=1 -t -A \
  -c "SELECT command_id, requested_at, requested_at_utc FROM device_commands WHERE idempotency_key = '$IOT_ROLLBACK_MARKER-n-command'" > "$IOT_EIGHT_ROOT/command-storage.txt"
cat > "$IOT_EIGHT_ROOT/compose-rollback.yml" <<YAML
services:
  backend:
    image: iot-manager-eight-n1:$GITHUB_RUN_ID
    environment:
      IOT_AI_ENABLED: "false"
      SPRING_FLYWAY_IGNORE_MIGRATION_PATTERNS: "*:future"
YAML
mode=rollback
active_compose up -d --no-build --pull never --no-deps backend
wait_backend
node "$IOT_EIGHT_TOOLS/snapshot-runtime.mjs" n-minus-one "$(active_compose ps -q backend)"
export IOT_ROLLBACK_PHASE=read
set +e
run_tests rollback-read "$repository_root/apps/client-glass-next/e2e/rollback-data-compatibility.spec.js"
rollback_status=$?
set -e
export EIGHT_DB_AFTER="$(active_compose ps -q postgres)"
export EIGHT_N1_IMAGE="$(docker inspect --format '{{.Image}}' "$(active_compose ps -q backend)")"
active_compose exec -T postgres application-role-psql.sh -v ON_ERROR_STOP=1 -t -A \
  -c 'SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank' > "$IOT_EIGHT_ROOT/migrations-after.txt"
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = process.env.IOT_EIGHT_ROOT;
const digest = name => createHash('sha256').update(readFileSync(root + '/' + name)).digest('hex');
const before = digest('migrations-before.txt'), after = digest('migrations-after.txt');
const json = name => JSON.parse(readFileSync(root + '/' + name, 'utf8'));
writeFileSync(root + '/rollback-evidence.json', JSON.stringify({ nCommit: process.env.GITHUB_SHA,
  nMinusOneCommit: 'e0977e77220773182df4e3a73741686cbb87c6d9', approvedProductionReleaseDrill: false,
  nImage: process.env.EIGHT_N_IMAGE, nMinusOneImage: process.env.EIGHT_N1_IMAGE,
  distinctImages: process.env.EIGHT_N_IMAGE !== process.env.EIGHT_N1_IMAGE,
  sameDatabase: process.env.EIGHT_DB_BEFORE === process.env.EIGHT_DB_AFTER,
  migrationsBeforeSha256: before, migrationsAfterSha256: after, sameMigrations: before === after,
  nRuntime: json('n-runtime.json'), nMinusOneRuntime: json('n-minus-one-runtime.json'),
  nProbe: json('rollback-write-probe.json'), nMinusOneProbe: json('rollback-read-probe.json'),
  commandStorage: readFileSync(root + '/command-storage.txt', 'utf8').trim() }, null, 2));
NODE
if (( rollback_status != 0 )); then exit "$rollback_status"; fi
mode=ai
active_compose up -d --no-build --pull never --no-deps backend
wait_backend
export IOT_ROLLBACK_PHASE=resume
run_tests rollback-resume "$repository_root/apps/client-glass-next/e2e/rollback-data-compatibility.spec.js"
export EIGHT_RESUMED_IMAGE="$(docker inspect --format '{{.Image}}' "$(active_compose ps -q backend)")"
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.IOT_EIGHT_ROOT, file=root+'/rollback-evidence.json';
const value=JSON.parse(readFileSync(file,'utf8'));
assert.equal(process.env.EIGHT_RESUMED_IMAGE, value.nImage, 'Resume must restore the exact N image');
value.resumedNImage=process.env.EIGHT_RESUMED_IMAGE;
value.resumeProbe=JSON.parse(readFileSync(root+'/rollback-resume-probe.json','utf8'));
writeFileSync(file,JSON.stringify(value,null,2));
NODE
echo '::notice title=R01 passed::Actual version switch, legacy timestamps, read/write and migration invariants passed.'
echo 'All eight scenarios executed; validating structured evidence and cleaning the dedicated project.'
