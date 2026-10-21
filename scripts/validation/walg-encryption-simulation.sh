#!/usr/bin/env bash
# Read-only, digest-bound container probe using disposable tmpfs storage.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || exit 64
out=artifacts/simulation/walg-encryption
mkdir -p "$out"
image="$(node scripts/ci/release-tools.mjs list-digest-artifacts --manifest artifacts/release/image-digests.json | awk -F '\t' '$1 == "IMG-R04" {print $2}')"
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || exit 64
fix=cadf598e1c2a345915a21a44518c5a4d5401e2e3
source="$(sed -n 's/^ARG WAL_G_SOURCE_COMMIT=//p' deploy/postgres/Dockerfile | tr -d '\r')"
[[ "$source" =~ ^[0-9a-f]{40}$ ]] || exit 64
gh api "repos/wal-g/wal-g/compare/$fix...$source" --jq '{status,mergeBase:.merge_base_commit.sha}' > "$out/upstream-ancestry.json"
node -e 'const p=require("./artifacts/simulation/walg-encryption/upstream-ancestry.json");require("node:assert/strict").equal(p.mergeBase,process.argv[1])' "$fix"
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=4m --cap-drop ALL \
  --entrypoint /bin/sh "$image" -ec '/usr/local/bin/wal-g --version; sha256sum /usr/local/bin/wal-g' > "$out/binary.txt"
grep -Fq "$source" "$out/binary.txt"
for setting in WALG_LIBSODIUM_KEY WALG_LIBSODIUM_KEY_PATH; do
  if docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
    -e "SIMULATION_KEY_SETTING=$setting" --entrypoint /bin/sh "$image" -ec '
      mkdir /tmp/walg
      key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      if [ "$SIMULATION_KEY_SETTING" = WALG_LIBSODIUM_KEY ]; then
        export WALG_LIBSODIUM_KEY="$key"
      else
        printf "%s" "$key" > /tmp/key
        export WALG_LIBSODIUM_KEY_PATH=/tmp/key
      fi
      export WALG_FILE_PREFIX=/tmp/walg
      # Listing an empty repository never creates a crypter. Exercise the
      # actual archive write path instead, entirely inside disposable tmpfs.
      head -c 16777216 /dev/zero > /tmp/000000010000000000000001
      exec /usr/local/bin/wal-g wal-push /tmp/000000010000000000000001
    ' > "$out/$setting.log" 2>&1; then
    printf 'Unsupported encryption was silently accepted: %s\n' "$setting" >&2
    exit 1
  fi
  grep -Fq 'but wal-g was not compiled with libsodium' "$out/$setting.log"
done
export SIMULATION_WALG_IMAGE="$image"
node --input-type=module <<'NODE'
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync('artifacts/release/image-digests.json'));
fs.writeFileSync('artifacts/simulation/walg-encryption/proof.json',JSON.stringify({schemaVersion:1,
  artifact:'IMG-R04',imageDigest:process.env.SIMULATION_WALG_IMAGE.split('@')[1],sourceSha:manifest.sourceSha,
  cve:'CVE-2021-38599',conclusion:'fixed',passed:true,productionApproved:false,
  fixCommit:'cadf598e1c2a345915a21a44518c5a4d5401e2e3',fixIsAncestor:true,
  checks:[{name:'Upstream fix is ancestor of exact WAL-G source',passed:true},
    {name:'Final digest rejects unsupported inline libsodium key',passed:true},
    {name:'Final digest rejects unsupported libsodium key file',passed:true}],
  upstreamReferences:['https://github.com/wal-g/wal-g/pull/1062'],
  approvalStatus:'DRAFT_REQUIRES_INDEPENDENT_REVIEW'},null,2)+'\n');
NODE
