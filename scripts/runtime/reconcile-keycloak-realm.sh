#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_name="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
state_file="${IOT_RUNTIME_STATE_FILE:-$repository_root/deploy/.runtime/iot-manager-p0/runtime.env}"
verify_idempotent=false
case "${1:-}" in
  "") ;;
  --verify-idempotent) verify_idempotent=true ;;
  *) printf 'Unsupported reconciliation argument: %s\n' "$1" >&2; exit 64 ;;
esac

[[ -f "$environment_file" ]] || { printf 'Environment file was not found: %s\n' "$environment_file" >&2; exit 66; }

# Git Bash rewrites Unix-looking paths in docker arguments. Normalize host
# files first and suppress that rewrite only for the Keycloak container path.
docker_host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath --mixed "$1"
  else
    printf '%s' "$1"
  fi
}

docker_container_paths() {
  if command -v cygpath >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 docker "$@"
  else
    docker "$@"
  fi
}

compose=(compose --project-name "$project_name" --env-file "$(docker_host_path "$environment_file")")
[[ -f "$state_file" ]] && compose+=(--env-file "$(docker_host_path "$state_file")")
compose_files_csv="${IOT_COMPOSE_FILES:-$repository_root/deploy/docker-compose.yml,$repository_root/deploy/docker-compose.integration.yml}"
IFS=',' read -r -a compose_files <<< "$compose_files_csv"
for compose_file in "${compose_files[@]}"; do
  [[ -n "$compose_file" ]] || continue
  [[ "$compose_file" = /* ]] || compose_file="$repository_root/$compose_file"
  [[ -f "$compose_file" ]] || { printf 'Compose file was not found: %s\n' "$compose_file" >&2; exit 66; }
  compose+=(-f "$(docker_host_path "$compose_file")")
done

reconcile_args=()
[[ "$verify_idempotent" == true ]] && reconcile_args+=(--verify-idempotent)
output="$(docker_container_paths "${compose[@]}" exec -T keycloak /opt/keycloak/bin/reconcile-keycloak-realm.sh "${reconcile_args[@]}")"
printf '%s\n' "$output"
if [[ "$verify_idempotent" == true ]]; then
  printf '%s\n' "$output" | grep -qx 'KEYCLOAK_REALM_RECONCILE_IDEMPOTENT=true' || {
    printf 'Keycloak realm reconciliation did not prove idempotence.\n' >&2
    exit 70
  }
fi
