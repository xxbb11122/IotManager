import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSecretDirectory } from '../../runtime/resolve-secret-directory.mjs';

const root = resolve(import.meta.dirname, '../../..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

const releaseGate = read('.github/workflows/release-gate.yml');
const rollback = read('.github/workflows/rollback-drill.yml');
const rollbackCompose = read('deploy/docker-compose.rollback.yml');
const launcher = read('scripts/runtime/start-integration.sh');
const launcherPs = read('scripts/runtime/start-integration.ps1');
const secretGenerator = read('scripts/runtime/new-secrets.sh');
const logicalRecovery = read('scripts/runtime/recovery-drill.sh');
const logicalRecoveryPs = read('scripts/runtime/recovery-drill.ps1');
const physicalRecovery = read('scripts/runtime/wal-recovery-drill.sh');
const backupScript = read('deploy/backup/backup.sh');
const backupHealthcheck = read('deploy/backup/backup-healthcheck.sh');
const runtimeWorkflow = read('.github/workflows/runtime-e2e.yml');
const recoveryWorkflow = read('.github/workflows/recovery-drill.yml');
const quickCi = read('.github/workflows/ci.yml');

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
assert.doesNotMatch(rollback.split('    steps:')[0], /^\s+DOCKER_CONFIG:\s*\$\{\{\s*runner\.temp/m,
  'runner.temp is not available in the rollback job-level env context.');
assert.match(rollback, /Prepare isolated registry credential directory[\s\S]*\$RUNNER_TEMP[\s\S]*install -d -m 0700[\s\S]*\$GITHUB_ENV/,
  'The registry credential directory must be initialized at step runtime and exported to later steps.');
assert.match(rollback, /if \[\[ -n "\$\{DOCKER_CONFIG:-\}" \]\]/,
  'Always-run credential cleanup must remain safe if setup failed before DOCKER_CONFIG was exported.');

const pullIndex = rollback.indexOf('docker pull "$image_ref"');
const startupIndex = rollback.indexOf('start-integration.sh');
assert.ok(pullIndex >= 0 && startupIndex > pullIndex,
  'Digest pre-pull must be ordered before immutable startup.');
assert.match(launcher, /start_flags\+=\(--no-build --pull never\)/,
  'The integration launcher must enforce immutable no-build/no-pull startup.');
assert.match(rollbackCompose, /SPRING_FLYWAY_IGNORE_MIGRATION_PATTERNS: "\*:future"/,
  'Compose must pass the narrowly scoped rollback Flyway compatibility variable.');

assert.equal(resolveSecretDirectory(root, './.runtime/iot-manager-p0/secrets'),
  resolve(root, 'deploy/.runtime/iot-manager-p0/secrets'),
  'Relative integration secret paths must resolve from deploy/, the Compose base directory.');
assert.equal(resolveSecretDirectory(root, 'C:\\protected\\iot-manager-secrets'), 'C:\\protected\\iot-manager-secrets',
  'An absolute Windows secret path must be preserved when tested on a POSIX CI runner.');
assert.match(launcher, /resolve-secret-directory\.mjs[\s\S]*export IOT_SECRET_DIR="\$secret_directory"[\s\S]*Required integration secret file is missing, empty, or unreadable/,
  'The Bash launcher must export the Compose-resolved secret path and fail before startup for an invalid secret file.');
assert.match(launcher, /secret_directory="\$\{IOT_SECRET_DIR:-\$\(environment_value IOT_SECRET_DIR/,
  'An explicit per-run secret directory must override the template for isolated immutable runtime projects.');
assert.match(launcherPs, /resolve-secret-directory\.mjs[\s\S]*\$env:IOT_SECRET_DIR = \$secretDirectory[\s\S]*Required integration secret file is missing or empty/,
  'The PowerShell launcher must use the same secret path and preflight contract.');
assert.match(launcherPs, /if \(-not \[string\]::IsNullOrWhiteSpace\(\$env:IOT_SECRET_DIR\)\)/,
  'The PowerShell launcher must honor the same explicit per-run secret directory override.');
assert.match(runtimeWorkflow, /IOT_SECRET_DIR: \$\{\{ github\.workspace \}\}\/deploy\/\.runtime\/iot-manager-release-\$\{\{ github\.run_id \}\}\/secrets/,
  'The immutable runtime job must keep secrets under its exact run-scoped cleanup directory.');
assert.match(secretGenerator, /repository_root\/deploy\/\$\{secret_directory#\.\/\}/,
  'Relative calls to the Bash secret generator must share the deploy/ path base.');
assert.match(runtimeWorkflow, /rm -rf deploy\/\.runtime\/iot-manager-p0 deploy\/\.runtime\/iot-manager-p0-recovery/,
  'P0 cleanup must be restricted to its two named Compose projects.');
assert.match(runtimeWorkflow, /rm -rf "deploy\/\.runtime\/\$expected_project" deploy\/\.env\.integration/,
  'Immutable runtime cleanup must be restricted to this run-specific project.');
const immutableRuntimeCleanup = runtimeWorkflow.slice(runtimeWorkflow.indexOf('Stop only the release Compose project'));
assert.match(immutableRuntimeCleanup, /expected_project="iot-manager-release-\$\{GITHUB_RUN_ID\}"[\s\S]*remaining_containers[\s\S]*remaining_volumes[\s\S]*exit "\$cleanup_status"/,
  'Immutable runtime cleanup must verify its exact project and fail if resources remain.');
assert.doesNotMatch(immutableRuntimeCleanup, /down[^\n]*\|\|\s*true/,
  'Immutable runtime cleanup must not hide teardown failures.');
assert.match(recoveryWorkflow, /expected_project="iot-manager-gate2-pitr-\$\{GITHUB_RUN_ID\}"[\s\S]*remaining_containers[\s\S]*remaining_volumes[\s\S]*exit "\$cleanup_status"/,
  'Scheduled recovery cleanup must verify its exact project and fail if resources remain.');
assert.match(recoveryWorkflow, /expected_recovery="iot-manager-release-pitr-\$\{GITHUB_RUN_ID\}"[\s\S]*expected_logical="iot-manager-release-logical-\$\{GITHUB_RUN_ID\}"[\s\S]*remaining_volumes/,
  'Immutable recovery cleanup must validate and verify both run-scoped Compose projects.');
assert.doesNotMatch(recoveryWorkflow, /down[^\n]*\|\|\s*true/,
  'Recovery cleanup must not hide teardown failures.');

assert.match(backupScript, /source_flyway_version=.*flyway_schema_history[\s\S]*backupSha256[\s\S]*sourceFlywayVersion/,
  'Every logical dump must carry backup-checksum-bound source schema metadata.');
assert.match(backupHealthcheck, /metadata_file=.*metadata_name[\s\S]*metadata_checksum.*recorded_checksum[\s\S]*metadata_version/,
  'Backup health must require consistent schema metadata in addition to the dump and checksum.');
assert.match(logicalRecovery, /\.metadata\.json[\s\S]*backupSha256[\s\S]*sourceFlywayVersion[\s\S]*recoveredFlywayVersion/,
  'Bash logical recovery must prove the backup-time schema version and emit the recovered version.');
const logicalRecoveryVersionPattern = logicalRecovery.match(/!\s*\/([^/]+)\/\.test\(String\(metadata\.sourceFlywayVersion\)\)/)?.[1];
assert.ok(logicalRecoveryVersionPattern, 'Bash logical recovery must validate numeric source migration metadata.');
assert.equal(new RegExp(logicalRecoveryVersionPattern).test('25'), true,
  'Bash logical recovery must accept a numeric schema version in backup metadata.');
assert.equal(new RegExp(logicalRecoveryVersionPattern).test('V25'), false,
  'Bash logical recovery must reject a nonnumeric schema version in backup metadata.');
assert.match(logicalRecoveryPs, /\.metadata\.json[\s\S]*sourceFlywayVersion[\s\S]*recoveredFlywayVersion/,
  'PowerShell logical recovery must use the same version-bound metadata contract.');
assert.match(logicalRecoveryPs, /WriteAllText\(\$reportPath,[\s\S]*UTF8Encoding\]::new\(\$false\)/,
  'PowerShell recovery evidence must be emitted as UTF-8 JSON without a BOM.');
assert.match(physicalRecovery, /source_flyway_version=[\s\S]*flyway_schema_history[\s\S]*candidateFlywayVersion[\s\S]*recoveredFlywayVersion/,
  'Physical recovery must compare source, checked-out candidate, and recovered schema versions.');
assert.doesNotMatch(logicalRecovery + logicalRecoveryPs + physicalRecovery + recoveryWorkflow, /(?:\:-|else\s*\{\s*)['"]?18['"]?/,
  'Recovery scripts and workflows must not guess the schema version from stale V18 defaults.');
assert.match(runtimeWorkflow, /\.metadata\.json/,
  'Runtime logical restore must retrieve and validate the metadata sidecar.');
assert.match(recoveryWorkflow, /\.metadata\.json[\s\S]*candidateFlywayVersion/,
  'The protected immutable recovery evidence must bind the dump metadata to its candidate.');

assert.match(quickCi, /android-actions\/setup-android\@40fd30fb8d7440372e1316f5d1809ec01dcd3699[\s\S]*packages: ''/,
  'Android setup must use the pinned v4.0.1 action with automatic deprecated package installation disabled.');
assert.match(quickCi, /sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36\.0\.0"[\s\S]*Verify APK and write checksum[\s\S]*sha256sum/,
  'Android toolchains must be installed explicitly and the nonempty APK must receive a SHA-256 sidecar.');
assert.doesNotMatch(quickCi, /android-actions\/setup-android\@[^\s]+ # v3/,
  'The broken v3 Android SDK setup action must not remain in Quick CI.');

console.log('PASS release workflow contract tests');
