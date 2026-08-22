#!/usr/bin/env bash
set -euo pipefail

run_android=false
skip_backend=false
skip_web=false
skip_deploy=false

for argument in "$@"; do
  case "$argument" in
    --android) run_android=true ;;
    --skip-backend) skip_backend=true ;;
    --skip-web) skip_web=true ;;
    --skip-deploy) skip_deploy=true ;;
    *)
      printf 'Unknown option: %s\n' "$argument" >&2
      printf 'Usage: %s [--android] [--skip-backend] [--skip-web] [--skip-deploy]\n' "$0" >&2
      exit 2
      ;;
  esac
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf '%s was not found. %s\n' "$name" "$hint" >&2
    exit 1
  fi
}

verify_node() {
  require_command node 'Install Node.js 22 or newer.'
  local major_version
  major_version="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$major_version" -lt 22 ]; then
    printf 'Node.js 22 or newer is required; found %s.\n' "$(node --version)" >&2
    exit 1
  fi
}

verify_maven_jdk() {
  require_command java 'Configure JDK 17 and put it on PATH.'
  require_command mvn 'Install Maven 3.9 or newer.'
  local maven_version
  maven_version="$(mvn --version 2>&1)"
  if ! grep -Eq 'Java version: 17([.[:space:]]|$)' <<<"$maven_version"; then
    printf 'Backend and Edge Agent verification require Maven to use JDK 17. Maven reported:\n%s\n' "$maven_version" >&2
    exit 1
  fi
}

verify_android_jdk() {
  require_command java 'Configure JDK 21 or newer for Android builds.'
  local java_version
  java_version="$(java -version 2>&1 | head -n 1)"
  if [[ ! "$java_version" =~ ([0-9]+) ]]; then
    printf 'Unable to determine the Android Java version: %s\n' "$java_version" >&2
    exit 1
  fi
  if [ "${BASH_REMATCH[1]}" -lt 21 ]; then
    printf 'Android verification requires JDK 21 or newer. Java reported: %s\n' "$java_version" >&2
    exit 1
  fi
}

if [ "$skip_backend" = false ]; then
  verify_maven_jdk
  for component in backend edge-agent; do
    printf '==> %s: tests and package (JDK 17)\n' "$component"
    (
      cd "$repository_root/$component"
      mvn --batch-mode --no-transfer-progress clean verify
    )
    # .dumpstream can contain an informational Maven classpath notice; .dump
    # is the Surefire diagnostic for an abnormal fork shutdown.
    if compgen -G "$repository_root/$component/target/surefire-reports/*.dump" > /dev/null; then
      printf '%s Maven verification produced Surefire shutdown dump(s).\n' "$component" >&2
      exit 1
    fi
  done
fi

if [ "$skip_web" = false ]; then
  verify_node
  for app in frontend console client; do
    printf '==> %s: install and build\n' "$app"
    (
      cd "$repository_root/$app"
      npm ci
      if [ "$app" = client ]; then
        npm test
        npm run test:e2e
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
      docker run --rm \
        -e DOMAIN=ci.example.test \
        -e ACME_EMAIL=ci@example.test \
        -v "$repository_root/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
        caddy:2-alpine \
        caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    else
      printf 'WARNING: Docker CLI was found but its engine is unavailable. Caddy runtime validation was skipped.\n' >&2
    fi
  else
    printf 'WARNING: Docker was not found. Deployment configuration validation was skipped.\n' >&2
  fi
fi

if [ "$run_android" = true ]; then
  verify_node
  verify_android_jdk
  if [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -z "${ANDROID_HOME:-}" ]; then
    printf 'Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an Android SDK containing API 36 and Build Tools 36.0.0.\n' >&2
    exit 1
  fi
  printf '==> Android: Capacitor sync and debug APK build (JDK 21+ expected)\n'
  (
    cd "$repository_root/client"
    npm ci
    npm run build
    npx cap sync android
  )
  (
    cd "$repository_root/client/android"
    chmod +x gradlew
    ./gradlew --no-daemon assembleDebug
  )
fi

printf 'Verification completed successfully.\n'
