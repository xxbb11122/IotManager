import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

const releaseGate = read('.github/workflows/release-gate.yml');
const rollback = read('.github/workflows/rollback-drill.yml');
const rollbackCompose = read('deploy/docker-compose.rollback.yml');
const launcher = read('scripts/runtime/start-integration.sh');

assert.match(releaseGate, /create-known-good-release-manifest/,
  'A completed Release Gate must generate a known-good release manifest.');
assert.match(releaseGate, /retention-days:\s*90/,
  'Short-lived Actions evidence must fit the public-repository 90-day limit.');
assert.match(releaseGate, /oras push[\s\S]*release-bundle\.tar\.gz/,
  'The complete release bundle must be archived durably in GHCR.');
assert.match(releaseGate, /oras pull "\$evidence_ref"/,
  'The Release Gate must prove retrieval by the immutable OCI digest.');
assert.match(releaseGate, /bundle=artifacts\/final\/release-bundle/,
  'The final Gate must create a self-contained release bundle.');
assert.match(releaseGate, /cp artifacts\/final\/release-manifest\.json "\$bundle\/release-manifest\.json"/,
  'The final evidence bundle must contain its known-good manifest.');
assert.match(releaseGate, /release-manifest\.json\.sha256/,
  'The final evidence bundle must retain the manifest checksum sidecar.');
assert.match(releaseGate, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/,
  'The known-good manifest must receive a pinned artifact attestation.');
assert.match(releaseGate, /artifact-metadata:\s*write/,
  'The attestation job must be allowed to create artifact metadata records.');
assert.match(releaseGate, /release-manifest\.attestation\.json/,
  'The signed bundle must be retained with the final release evidence.');

assert.match(rollback, /workflow_dispatch:/,
  'Rollback drills must be manually dispatched.');
assert.match(rollback, /environment:\s*r1-rollback-drill/,
  'Rollback drills must be protected by the dedicated environment.');
assert.match(rollback, /self-hosted, linux, iot-manager-recovery/,
  'Rollback drills must run on the protected recovery runner class.');
assert.match(rollback, /validate-known-good-release-manifest/,
  'Rollback drills must reject incomplete or unapproved release evidence.');
assert.match(rollback, /gh attestation verify[\s\S]*--signer-workflow/,
  'Rollback drills must verify the approved Release Gate signer.');
assert.match(rollback, /release-manifest\.attestation\.json/,
  'Rollback must require the offline-verifiable attestation bundle.');
assert.match(rollback, /current_evidence_digest[\s\S]*rollback_evidence_digest/,
  'Rollback must accept N and N-1 by immutable evidence digest.');
assert.match(rollback, /oras pull --registry-config "\$DOCKER_CONFIG\/config\.json" "\$repository@\$digest"/,
  'Rollback must retrieve retained evidence from GHCR, not an expiring Actions artifact.');
assert.match(rollback, /docker pull "\$image_ref"/,
  'Every release image must be pre-pulled before immutable startup.');
assert.match(rollback, /docker login ghcr\.io[\s\S]*docker pull "\$image_ref"/,
  'Private GHCR images must be authenticated before pre-pull.');
assert.match(rollback, /Ports 80\/443 are already bound; the rollback drill refuses a shared or production host/,
  'Rollback startup must reject a host with an existing public listener.');
assert.match(rollback, /artifact-metadata:\s*write/,
  'The rollback attestation must be allowed to create artifact metadata records.');
assert.match(rollback, /--mode immutable/,
  'The workflow must use the immutable startup mode for both candidates.');
assert.match(rollback, /rollback-start-monotonic-ns\.txt[\s\S]*rollback-duration-seconds\.txt/,
  'Rollback RTO must be measured with a monotonic clock.');
assert.match(rollback, /oras push[\s\S]*rollback-proof\.tar\.gz/,
  'Successful rollback proof must outlive the public Actions artifact window.');
assert.match(rollback, /IOT_ROLLBACK_COMPATIBILITY_MODE=true/,
  'Only the N-1 phase may opt into future-migration compatibility.');
assert.match(rollback, /rollback-data-compatibility\.spec\.js/,
  'The workflow must prove N write -> N-1 read/write compatibility.');
assert.match(rollback, /runtime-auth\.spec\.js/,
  'The N-1 phase must exercise OIDC, RBAC, API, and WebSocket boundaries.');
assert.match(rollback, /down -v --remove-orphans/,
  'Rollback cleanup must destroy the isolated volumes.');
assert.match(rollback, /test "\$IOT_ROLLBACK_PROJECT" = "iot-manager-rollback-\$GITHUB_RUN_ID"/,
  'Cleanup must accept only the exact workflow-specific Compose project.');
assert.ok(rollback.indexOf('down -v --remove-orphans') < rollback.indexOf('Attest successful rollback decision'),
  'Isolated teardown must pass before a rollback success proof is signed.');

const pullIndex = rollback.indexOf('docker pull "$image_ref"');
const startupIndex = rollback.indexOf('start-integration.sh');
assert.ok(pullIndex >= 0 && startupIndex > pullIndex,
  'Digest pre-pull must be ordered before immutable startup.');
assert.match(launcher, /start_flags\+=\(--no-build --pull never\)/,
  'The integration launcher must enforce immutable no-build/no-pull startup.');
assert.match(rollbackCompose, /SPRING_FLYWAY_IGNORE_MIGRATION_PATTERNS: "\*:future"/,
  'Compose must pass the narrowly scoped rollback Flyway compatibility variable.');

console.log('PASS release workflow contract tests');
