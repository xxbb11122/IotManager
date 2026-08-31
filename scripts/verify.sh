#!/usr/bin/env bash
set -euo pipefail

run_android=false
skip_backend=false
skip_web=false
skip_deploy=false
strict_mode=false
declare -a skip_summaries=()

for argument in "$@"; do
  case "$argument" in
    --android) run_android=true ;;
    --skip-backend) skip_backend=true ;;
    --skip-web) skip_web=true ;;
    --skip-deploy) skip_deploy=true ;;
    --strict) strict_mode=true ;;
    *)
      printf 'Unknown option: %s\n' "$argument" >&2
      printf 'Usage: %s [--android] [--strict] [--skip-backend] [--skip-web] [--skip-deploy]\n' "$0" >&2
      exit 2
      ;;
  esac
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
maven_wrapper="$repository_root/mvnw"
summary_file="${IOT_VERIFY_SUMMARY_FILE:-}"

if [ -n "$summary_file" ]; then
  mkdir -p "$(dirname "$summary_file")"
  printf 'scope,total,failures,errors,skipped\n' > "$summary_file"
fi

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf '%s was not found. %s\n' "$name" "$hint" >&2
    exit 1
  fi
}

record_summary() {
  local scope="$1"
  local total="$2"
  local failures="$3"
  local errors="$4"
  local skipped="$5"

  printf '==> %s: tests=%s, failures=%s, errors=%s, skipped=%s\n' \
    "$scope" "$total" "$failures" "$errors" "$skipped"
  if [ -n "$summary_file" ]; then
    printf '%s,%s,%s,%s,%s\n' "$scope" "$total" "$failures" "$errors" "$skipped" >> "$summary_file"
  fi
}

register_skip() {
  local description="$1"
  if [ "$strict_mode" = true ]; then
    printf 'Strict verification refuses to continue: %s\n' "$description" >&2
    exit 1
  fi
  skip_summaries+=("$description")
}

verify_node() {
  require_command node 'Install Node.js 22 (use the repository .nvmrc).'
  local major_version
  major_version="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$major_version" -ne 22 ]; then
    printf 'Node.js 22 is required; found %s. Activate the version in .nvmrc.\n' "$(node --version)" >&2
    exit 1
  fi
}

maven() {
  if [ ! -f "$maven_wrapper" ]; then
    printf 'Maven Wrapper was not found at %s. Restore the repository wrapper files.\n' "$maven_wrapper" >&2
    exit 1
  fi
  bash "$maven_wrapper" "$@"
}

verify_maven_jdk() {
  require_command java 'Configure JDK 17 and put it on PATH.'
  local maven_version
  maven_version="$(maven --version 2>&1)"
  if ! grep -Eq '^Apache Maven 3\.9\.[0-9]+' <<<"$maven_version"; then
    printf 'Maven Wrapper must resolve Maven 3.9 or newer. Maven reported:\n%s\n' "$maven_version" >&2
    exit 1
  fi
  if ! grep -Eq 'Java version: 17([.[:space:]]|$)' <<<"$maven_version"; then
    printf 'Backend and Edge Agent verification require Maven to use JDK 17. Maven reported:\n%s\n' "$maven_version" >&2
    exit 1
  fi
}

verify_android_jdk() {
  require_command java 'Configure JDK 21 for Android builds.'
  local java_version
  java_version="$(java -version 2>&1 | head -n 1)"
  if [[ ! "$java_version" =~ ([0-9]+) ]]; then
    printf 'Unable to determine the Android Java version: %s\n' "$java_version" >&2
    exit 1
  fi
  if [ "${BASH_REMATCH[1]}" -ne 21 ]; then
    printf 'Android verification requires JDK 21. Java reported: %s\n' "$java_version" >&2
    exit 1
  fi
}

xml_attribute() {
  local suite_line="$1"
  local attribute="$2"
  local value
  value="$(sed -nE "s/.*[[:space:]]${attribute}=\"([0-9]+)\".*/\1/p" <<<"$suite_line" | head -n 1)"
  if [ -z "$value" ]; then
    value=0
  fi
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    printf 'Invalid Surefire %s value: %s\n' "$attribute" "$value" >&2
    exit 1
  fi
  printf '%s' "$value"
}

collect_surefire_summary() {
  local component="$1"
  local report_dir="$repository_root/$component/target/surefire-reports"
  local -a reports=()
  local report suite_line test_count failure_count error_count skipped_count
  local tests=0 failures=0 errors=0 skipped=0

  shopt -s nullglob
  reports=("$report_dir"/TEST-*.xml)
  shopt -u nullglob
  if [ "${#reports[@]}" -eq 0 ]; then
    printf '%s did not produce any Surefire XML reports.\n' "$component" >&2
    exit 1
  fi

  for report in "${reports[@]}"; do
    suite_line="$(grep -m 1 '<testsuite ' "$report" || true)"
    if [ -z "$suite_line" ]; then
      printf 'Unable to read the testsuite summary from %s.\n' "$report" >&2
      exit 1
    fi
    test_count="$(xml_attribute "$suite_line" tests)"
    failure_count="$(xml_attribute "$suite_line" failures)"
    error_count="$(xml_attribute "$suite_line" errors)"
    skipped_count="$(xml_attribute "$suite_line" skipped)"
    tests=$((tests + test_count))
    failures=$((failures + failure_count))
    errors=$((errors + error_count))
    skipped=$((skipped + skipped_count))
  done

  if [ "$tests" -eq 0 ]; then
    printf '%s reported zero executed tests.\n' "$component" >&2
    exit 1
  fi
  record_summary "surefire:$component" "$tests" "$failures" "$errors" "$skipped"
  if [ "$failures" -ne 0 ] || [ "$errors" -ne 0 ]; then
    printf '%s Surefire reports contain failures or errors despite Maven success.\n' "$component" >&2
    exit 1
  fi
  if [ "$skipped" -ne 0 ]; then
    register_skip "$component Surefire reports contain $skipped skipped test(s)"
  fi
}

tap_count() {
  local report="$1"
  local label="$2"
  local value
  value="$(awk -v prefix="# $label " 'index($0, prefix) == 1 { value = $3 } END { print value }' "$report")"
  if [ -z "$value" ]; then
    value=0
  fi
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    printf 'Invalid Node test %s count: %s\n' "$label" "$value" >&2
    exit 1
  fi
  printf '%s' "$value"
}

run_client_unit_tests() {
  local report
  report="$(mktemp "${TMPDIR:-/tmp}/iot-manager-node-tests.XXXXXX")"
  if ! npm test -- --test-reporter=tap | tee "$report"; then
    rm -f "$report"
    printf 'client Node unit tests failed.\n' >&2
    exit 1
  fi
  local tests failures cancelled skipped
  tests="$(tap_count "$report" tests)"
  failures="$(tap_count "$report" fail)"
  cancelled="$(tap_count "$report" cancelled)"
  skipped="$(tap_count "$report" skipped)"
  rm -f "$report"

  if [ "$tests" -eq 0 ]; then
    printf 'client Node tests reported zero executed tests.\n' >&2
    exit 1
  fi
  record_summary 'node:client' "$tests" "$failures" "$cancelled" "$skipped"
  if [ "$failures" -ne 0 ] || [ "$cancelled" -ne 0 ]; then
    printf 'client Node tests contain failures or cancellations.\n' >&2
    exit 1
  fi
  if [ "$skipped" -ne 0 ]; then
    register_skip "client Node tests contain $skipped skipped test(s)"
  fi
}

run_client_playwright_tests() {
  local report
  report="$(mktemp "${TMPDIR:-/tmp}/iot-manager-playwright-tests.XXXXXX")"
  local -a playwright_args=(playwright test --reporter=json)
  if [ "$strict_mode" = true ]; then
    # Runtime-auth is executed separately by runtime-e2e.yml with a real stack.
    playwright_args+=(e2e/mobile-client.spec.js)
  fi
  if ! npx "${playwright_args[@]}" > "$report"; then
    cat "$report" >&2 || true
    rm -f "$report"
    printf 'client Playwright tests failed.\n' >&2
    exit 1
  fi

  local summary
  summary="$(node - "$report" <<'NODE'
const { readFileSync } = require('node:fs');
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const stats = report.stats ?? {};
const number = (key) => Number(stats[key] ?? 0);
process.stdout.write([number('expected'), number('unexpected'), number('flaky'), number('skipped')].join(' '));
NODE
)"
  rm -f "$report"

  local expected unexpected flaky skipped
  read -r expected unexpected flaky skipped <<<"$summary"
  if ! [[ "$expected" =~ ^[0-9]+$ && "$unexpected" =~ ^[0-9]+$ && "$flaky" =~ ^[0-9]+$ && "$skipped" =~ ^[0-9]+$ ]]; then
    printf 'Unable to parse the Playwright JSON summary: %s\n' "$summary" >&2
    exit 1
  fi
  if [ "$expected" -eq 0 ]; then
    printf 'client Playwright tests reported zero executed tests.\n' >&2
    exit 1
  fi
  record_summary 'playwright:client' "$expected" "$unexpected" "$flaky" "$skipped"
  if [ "$unexpected" -ne 0 ] || [ "$flaky" -ne 0 ]; then
    printf 'client Playwright tests contain unexpected or flaky results.\n' >&2
    exit 1
  fi
  if [ "$skipped" -ne 0 ]; then
    register_skip "client Playwright tests contain $skipped skipped test(s)"
  fi
}

run_web_playwright_tests() {
  local app="$1"
  local report
  report="$(mktemp "${TMPDIR:-/tmp}/iot-manager-${app}-playwright.XXXXXX")"

  # The caller has already changed into the application's directory, so this
  # deliberately uses that package's pinned Playwright runner and config.
  if ! npx playwright test --reporter=json > "$report"; then
    cat "$report" >&2 || true
    rm -f "$report"
    printf '%s Playwright tests failed.\n' "$app" >&2
    exit 1
  fi

  local summary
  summary="$(node - "$report" <<'NODE'
const { readFileSync } = require('node:fs');
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const stats = report.stats ?? {};
const number = (key) => Number(stats[key] ?? 0);
process.stdout.write([number('expected'), number('unexpected'), number('flaky'), number('skipped')].join(' '));
NODE
)"
  rm -f "$report"

  local expected unexpected flaky skipped
  read -r expected unexpected flaky skipped <<<"$summary"
  if ! [[ "$expected" =~ ^[0-9]+$ && "$unexpected" =~ ^[0-9]+$ && "$flaky" =~ ^[0-9]+$ && "$skipped" =~ ^[0-9]+$ ]]; then
    printf 'Unable to parse the %s Playwright JSON summary: %s\n' "$app" "$summary" >&2
    exit 1
  fi
  if [ "$expected" -eq 0 ]; then
    printf '%s Playwright tests reported zero executed tests.\n' "$app" >&2
    exit 1
  fi
  record_summary "playwright:$app" "$expected" "$unexpected" "$flaky" "$skipped"
  if [ "$unexpected" -ne 0 ] || [ "$flaky" -ne 0 ]; then
    printf '%s Playwright tests contain unexpected or flaky results.\n' "$app" >&2
    exit 1
  fi
  if [ "$skipped" -ne 0 ]; then
    register_skip "$app Playwright tests contain $skipped skipped test(s)"
  fi
}

if [ "$skip_backend" = false ]; then
  verify_maven_jdk
  for component in backend edge-agent; do
    printf '==> %s: tests and package (JDK 17, Maven Wrapper)\n' "$component"
    maven --batch-mode --no-transfer-progress -f "$repository_root/$component/pom.xml" clean verify
    # .dumpstream can contain an informational Maven classpath notice; .dump
    # is the Surefire diagnostic for an abnormal fork shutdown.
    if compgen -G "$repository_root/$component/target/surefire-reports/*.dump" > /dev/null; then
      printf '%s Maven verification produced Surefire shutdown dump(s).\n' "$component" >&2
      exit 1
    fi
    collect_surefire_summary "$component"
  done
fi

if [ "$skip_web" = false ]; then
  verify_node
  printf '==> Security: public Vite environment policy\n'
  node "$repository_root/scripts/verify-public-build-env.js"
  for app in frontend console client; do
    printf '==> %s: install and build\n' "$app"
    (
      cd "$repository_root/$app"
      npm ci
      if [ "$app" = client ]; then
        run_client_unit_tests
        run_client_playwright_tests
      else
        run_web_playwright_tests "$app"
      fi
      npm run build
    )
  done
fi

if [ "$skip_deploy" = false ]; then
  if command -v docker >/dev/null 2>&1; then
    printf '==> Deployment: Docker Compose configuration\n'
    DOMAIN=ci.example.test ACME_EMAIL=ci@example.test \
      docker compose --env-file "$repository_root/deploy/.env.example" -f "$repository_root/deploy/docker-compose.yml" config --quiet
    if docker info >/dev/null 2>&1; then
      printf '==> Deployment: Caddy configuration\n'
      caddyfile="$repository_root/deploy/Caddyfile"
      # Git Bash rewrites the container half of a -v argument (for example
      # /etc/caddy) into its own installation directory unless path conversion
      # is disabled. Convert only the host side to a Docker-compatible Windows
      # path, then pass the container side through untouched. Linux shells do
      # not provide cygpath and retain the original absolute path.
      if command -v cygpath >/dev/null 2>&1; then
        caddyfile="$(cygpath --mixed "$caddyfile")"
      fi
      MSYS_NO_PATHCONV=1 docker run --rm \
        -e DOMAIN=ci.example.test \
        -e ACME_EMAIL=ci@example.test \
        -v "$caddyfile:/etc/caddy/Caddyfile:ro" \
        caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 \
        caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    else
      register_skip 'Docker Engine is unavailable; Caddy runtime validation was skipped'
    fi
  else
    register_skip 'Docker CLI is unavailable; deployment validation was skipped'
  fi
fi

if [ "$run_android" = true ]; then
  verify_node
  verify_android_jdk
  if [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -z "${ANDROID_HOME:-}" ]; then
    printf 'Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an Android SDK containing API 36 and Build Tools 36.0.0.\n' >&2
    exit 1
  fi
  printf '==> Android: Capacitor sync and debug APK build (JDK 21)\n'
  (
    cd "$repository_root/client"
    npm ci
    npm run build
    npx cap sync android
  )
  printf '==> Android: verify synchronized public web assets contain no credentials\n'
  node "$repository_root/scripts/verify-public-build-env.js"
  (
    cd "$repository_root/client/android"
    chmod +x gradlew
    ./gradlew --no-daemon assembleDebug
  )
fi

if [ "${#skip_summaries[@]}" -gt 0 ]; then
  printf 'Verification completed with declared non-strict skips:\n'
  for summary in "${skip_summaries[@]}"; do
    printf '  - %s\n' "$summary"
  done
else
  printf 'Verification completed successfully.\n'
fi
