#!/bin/sh
set -eu

secret() {
  secret_file="/run/secrets/$1"
  if [ ! -r "$secret_file" ]; then
    echo "Required WAL-G secret is unavailable: $1" >&2
    exit 78
  fi
  value="$(cat "$secret_file")"
  if [ -z "$value" ]; then
    echo "Required WAL-G secret is empty: $1" >&2
    exit 78
  fi
  printf '%s' "$value"
}

: "${WALG_STORAGE_MODE:?WALG_STORAGE_MODE is required}"
case "$WALG_STORAGE_MODE" in
  filesystem)
    : "${WALG_FILE_PREFIX:?WALG_FILE_PREFIX is required for filesystem storage}"
    # WAL-G treats a missing basebackups directory as a storage error. Create
    # the empty layout on first start so backup-list can validate a fresh
    # filesystem repository before the first scheduled base backup exists.
    mkdir -p "$WALG_FILE_PREFIX/basebackups_005"
    export WALG_FILE_PREFIX
    unset WALG_S3_PREFIX AWS_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_S3_FORCE_PATH_STYLE
    ;;
  s3)
    : "${WALG_S3_PREFIX:?WALG_S3_PREFIX is required for S3 storage}"
    : "${AWS_REGION:?AWS_REGION is required for S3 storage}"
    export WALG_S3_PREFIX AWS_REGION
    [ -n "${AWS_ENDPOINT:-}" ] && export AWS_ENDPOINT
    [ -n "${AWS_S3_FORCE_PATH_STYLE:-}" ] && export AWS_S3_FORCE_PATH_STYLE
    export AWS_ACCESS_KEY_ID="$(secret walg_s3_access_key)"
    export AWS_SECRET_ACCESS_KEY="$(secret walg_s3_secret_key)"
    ;;
  *)
    echo "WALG_STORAGE_MODE must be filesystem or s3" >&2
    exit 64
    ;;
esac

export WALG_COMPRESSION_METHOD="${WALG_COMPRESSION_METHOD:-zstd}"
exec "$@"
