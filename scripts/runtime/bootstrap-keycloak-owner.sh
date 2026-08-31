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
  *) printf 'Unsupported bootstrap argument: %s\n' "$1" >&2; exit 64 ;;
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

bootstrap_args=()
[[ "$verify_idempotent" == true ]] && bootstrap_args+=(--verify-idempotent)
output="$(docker_container_paths "${compose[@]}" exec -T keycloak /opt/keycloak/bin/bootstrap-owner.sh "${bootstrap_args[@]}")"

subject_for_role() {
  local role="$1"
  local subject_line subject
  subject_line="$(printf '%s\n' "$output" | grep "^IOT_BOOTSTRAP_${role}_SUBJECT=" | tail -n 1 || true)"
  if [[ -z "$subject_line" ]]; then
    printf '%s' ''
    return 0
  fi
  subject="${subject_line#IOT_BOOTSTRAP_${role}_SUBJECT=}"
  [[ "$subject" =~ ^[0-9a-fA-F-]{36}$ ]] || {
    printf 'Keycloak %s bootstrap returned an invalid subject format.\n' "$role" >&2
    exit 70
  }
  printf '%s' "$subject"
}

owner_subject="$(subject_for_role OWNER)"
[[ -n "$owner_subject" ]] || { printf 'Keycloak OWNER bootstrap did not return a subject.\n' >&2; exit 70; }
admin_subject="$(subject_for_role ADMIN)"
operator_subject="$(subject_for_role OPERATOR)"
viewer_subject="$(subject_for_role VIEWER)"
if [[ "$verify_idempotent" == true ]]; then
  printf '%s\n' "$output" | grep -qx 'KEYCLOAK_BOOTSTRAP_IDEMPOTENT=true' || {
    printf 'Keycloak bootstrap did not prove idempotence.\n' >&2
    exit 70
  }
fi

mkdir -p "$(dirname "$state_file")"
tmp_file="$(mktemp "${state_file}.tmp.XXXXXX")"
if [[ -f "$state_file" ]]; then
  grep -Ev '^IOT_BOOTSTRAP_(OWNER|ADMIN|OPERATOR|VIEWER)_SUBJECT=' "$state_file" > "$tmp_file" || true
fi
printf 'IOT_BOOTSTRAP_OWNER_SUBJECT=%s\n' "$owner_subject" >> "$tmp_file"
if [[ -n "$admin_subject" ]]; then
  printf 'IOT_BOOTSTRAP_ADMIN_SUBJECT=%s\n' "$admin_subject" >> "$tmp_file"
fi
if [[ -n "$operator_subject" ]]; then
  printf 'IOT_BOOTSTRAP_OPERATOR_SUBJECT=%s\n' "$operator_subject" >> "$tmp_file"
fi
if [[ -n "$viewer_subject" ]]; then
  printf 'IOT_BOOTSTRAP_VIEWER_SUBJECT=%s\n' "$viewer_subject" >> "$tmp_file"
fi
chmod 600 "$tmp_file"
mv "$tmp_file" "$state_file"
printf 'Keycloak bootstrap state written: %s\n' "$state_file"
