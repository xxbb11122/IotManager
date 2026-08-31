#!/bin/sh
# Materialize Compose file secrets into per-service named volumes. Docker
# Compose implements `file:` secrets as bind mounts, preserving the host UID
# and mode; that makes a host-user-owned 0600 secret unreadable to an
# intentionally non-root container on Linux. Keep the host source directory
# private and copy only each service's required values into a volume owned by
# that service's runtime UID.
set -eu

require_source_secret() {
  source_name="$1"
  source_path="/source/${source_name}"
  if [ ! -r "$source_path" ] || [ ! -s "$source_path" ]; then
    printf 'Required source secret is unavailable or empty: %s\n' "$source_name" >&2
    exit 78
  fi
  printf '%s' "$source_path"
}

prepare_target() {
  target_dir="$1"
  uid="$2"
  gid="$3"
  mkdir -p "$target_dir"
  chown "$uid:$gid" "$target_dir"
  chmod 0700 "$target_dir"
}

copy_secret() {
  source_name="$1"
  target_dir="$2"
  target_name="$3"
  uid="$4"
  gid="$5"
  source_path="$(require_source_secret "$source_name")"
  temporary_path="${target_dir}/.${target_name}.tmp"
  target_path="${target_dir}/${target_name}"

  # The temporary file is created within the target volume, so rename is
  # atomic and a restarting service never observes a partially copied value.
  umask 077
  rm -f "$temporary_path"
  cp "$source_path" "$temporary_path"
  chown "$uid:$gid" "$temporary_path"
  chmod 0400 "$temporary_path"
  mv -f "$temporary_path" "$target_path"
}

# PostgreSQL itself needs the bootstrap and database-role passwords only.
prepare_target /targets/postgres 999 999
copy_secret postgres_admin_password /targets/postgres postgres_admin_password 999 999
copy_secret iot_db_owner_password /targets/postgres iot_db_owner_password 999 999
copy_secret iot_db_app_password /targets/postgres iot_db_app_password 999 999
copy_secret keycloak_db_password /targets/postgres keycloak_db_password 999 999

# Keycloak runs as UID 1000 in the pinned image.
prepare_target /targets/keycloak 1000 1000
copy_secret keycloak_db_password /targets/keycloak keycloak_db_password 1000 1000
copy_secret keycloak_bootstrap_admin_password /targets/keycloak keycloak_bootstrap_admin_password 1000 1000
copy_secret keycloak_owner_password /targets/keycloak keycloak_owner_password 1000 1000
copy_secret keycloak_admin_password /targets/keycloak keycloak_admin_password 1000 1000
copy_secret keycloak_operator_password /targets/keycloak keycloak_operator_password 1000 1000
copy_secret keycloak_viewer_password /targets/keycloak keycloak_viewer_password 1000 1000

# Backend configtree names are deliberately the Spring property names, not
# the source filenames. It runs as the dedicated `iot` UID 10001.
prepare_target /targets/backend 10001 10001
copy_secret iot_db_app_password /targets/backend IOT_DB_PASSWORD 10001 10001
copy_secret iot_db_owner_password /targets/backend IOT_FLYWAY_PASSWORD 10001 10001
copy_secret weather_fingerprint_secret /targets/backend IOT_WEATHER_FINGERPRINT_SECRET 10001 10001
copy_secret metrics_scrape_token /targets/backend IOT_METRICS_SCRAPE_TOKEN 10001 10001

prepare_target /targets/backup 999 999
copy_secret iot_db_owner_password /targets/backup iot_db_owner_password 999 999

prepare_target /targets/walg-archive 999 999
copy_secret walg_s3_access_key /targets/walg-archive walg_s3_access_key 999 999
copy_secret walg_s3_secret_key /targets/walg-archive walg_s3_secret_key 999 999

prepare_target /targets/walg-backup 999 999
copy_secret iot_db_owner_password /targets/walg-backup iot_db_owner_password 999 999
copy_secret walg_s3_access_key /targets/walg-backup walg_s3_access_key 999 999
copy_secret walg_s3_secret_key /targets/walg-backup walg_s3_secret_key 999 999

# Physical recovery is one-shot root work, isolated from the steady-state
# PostgreSQL service volume and supplied only the object-storage credentials.
prepare_target /targets/walg-recovery 0 0
copy_secret walg_s3_access_key /targets/walg-recovery walg_s3_access_key 0 0
copy_secret walg_s3_secret_key /targets/walg-recovery walg_s3_secret_key 0 0

prepare_target /targets/prometheus 65534 65534
copy_secret metrics_scrape_token /targets/prometheus metrics_scrape_token 65534 65534

printf 'Service-scoped runtime secret volumes initialized.\n'
