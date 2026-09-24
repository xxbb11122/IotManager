# CI / Release Runbook

## Two execution paths

- **Quick CI** runs source, application, Android, Compose, Caddy and source-security checks for pull requests and development branches. It does not publish release images.
- **Release Integrity Gate** is triggered by an r1-rc.* tag or an explicit dispatch. It freezes one Git SHA, builds six images once, resolves all eight artifacts by digest, scans all eight digests, runs the 12-service immutable runtime, then runs the protected physical recovery drill for the 13th service.

The final gate accepts only PASS. A skipped, incomplete, superseded, infrastructure-failed, or locally rebuilt stage is not releasable evidence.

## Operator prerequisites

1. Protect main and require Quick CI, Immutable Image Security, immutable runtime, protected recovery, and Release Integrity Gate.
2. Configure GHCR package write access for the release workflow and package read access for runtime/recovery runners.
3. Configure a protected iot-manager-recovery self-hosted runner and the r1-recovery-drill environment.
4. Set IOT_RECOVERY_SOURCE_PROJECT for tag-triggered gates, or supply source_project when dispatching the gate.
5. Configure the protected recovery environment secrets documented by deploy/DEPLOYMENT.md.
6. Install GitHub CLI and Python 3 on the protected recovery runner. GitHub
   CLI must support `gh attestation verify`; the workflow installs a
   checksum-pinned ORAS client for GHCR evidence retrieval.
7. Exclude the N/N-1/N-2 image digests and GHCR release-evidence package
   digests from cleanup for at least 180 days after supersession. The public
   repository's 90-day Actions artifact copy is not the retention store.

## Local modes

Local development preserves the existing build-on-start behavior:

    powershell scripts/runtime/start-integration.ps1 -Mode local

Immutable mode requires the candidate's `image-digests.json`, `release-candidate.json`, `release-topology.json`, and `release-services.json` in the same evidence directory. It validates their checksums and identity before it renders the Compose image environment; it does not build or resolve mutable tags:

    bash scripts/runtime/start-integration.sh --mode immutable --digest-manifest artifacts/release/image-digests.json

For logical recovery, use the same mode and manifest. The physical WAL-G drill additionally requires its protected production-shaped environment and explicit IOT_PITR_CONFIRM=PITR.

The final gate writes `runtime-image-verification.json`. It is not a count-only report: it merges the runtime 12/12 and recovery-added 1/1 evidence, requires exactly `SVC-01` through `SVC-13`, preserves one-shot `exited(0)` observations, and rejects unknown service IDs or any expected/actual digest mismatch.

## Isolated N-to-N-1 application rollback drill

`rollback-drill.yml` is a manual-only, protected `r1-rollback-drill`
workflow. It is deliberately separate from WAL-G recovery: application
rollback changes only the approved immutable image digest set; it does not
rewind Flyway or restore database data.

For the Expand/Contract window, `IOT_TIME_LEGACY_ZONE` must match the N-1
Backend's `TZ` used for its server-authored `LocalDateTime` columns. The
provided integration and production Compose examples both use
`Asia/Shanghai`; changing either side without a reviewed migration can make
N-1 reject newly created commands as expired. New Backend decisions always
use the UTC-aware columns, not these compatibility values.

Before dispatching it, obtain the exact GHCR release-evidence OCI digests
(`sha256:...`) recorded by Release Integrity Gate for the approved current
candidate **N** and its approved predecessor **N-1**. Confirm that both
digest-pinned bundles contain `release-manifest.json` with
`status: KNOWN_GOOD`. The workflow then:

1. downloads each approved GHCR evidence digest and verifies the archive and
   inner SHA256 checksums, the GitHub Sigstore artifact
   attestation (including its offline bundle), the exact Release Gate signer
   workflow identity, and Gate PASS evidence;
2. pre-pulls every N and N-1 image by immutable digest;
3. starts N in a dedicated `iot-manager-rollback-*` Compose project with
   separate database volumes and generated secrets, writes an authenticated
   device and command marker, and stops it without deleting the database volume;
4. starts N-1 with `--mode immutable --pull never --no-build`, lets only that
   isolated phase tolerate future **Expand** migrations, and verifies the
   marker and command read, legacy wall-clock compatibility, plus N-1 device
   and command writes;
5. runs certificate-verified OIDC, four-role RBAC, API v1, browser WebSocket
   and edge WebSocket checks; measures the application RTO with a monotonic
   timer; retains separate N and N-1 stack verification evidence within the
   rollback proof, along with separate Playwright JSON/output for all three
   phases; destroys the isolated project and volumes; and only after teardown
   succeeds signs and archives a redacted rollback proof in GHCR.

The recovery runner needs Docker, GHCR read access, passwordless `sudo` for
browser dependency installation, and enough disk for two complete
digest sets. It also needs GitHub CLI with `gh attestation verify`; verification
uses the retained bundle and pins the signer to
`.github/workflows/release-gate.yml`. The protected runner must have no
production Caddy bound to ports 80/443; the drill uses a dedicated host or
network namespace in addition to isolated Compose volumes. GHCR Docker credentials live only in a
run-specific temporary configuration, and the Caddy test CA is added only to
a run-specific NSS trust entry that cleanup removes. It must not point at a production
Compose project. A missing
digest, missing evidence, failed N-1 schema compatibility or failed boundary
check is a failed rollback drill. Do not replace that failure with a mutable
tag, local rebuild, `--pull always`, or a database restore.

`REGISTRY-RETENTION.md` defines the required N/N-1/N-2 + 180-day retention
policy. The workflow proves that a selected pair can be retrieved and records
the rollback-proof OCI digest; it does not itself change registry deletion
settings. Preserve that proof alongside the selected candidates for the same
review window.

## Failure handling

- A digest mismatch, missing service observation, scan failure, checksum mismatch, source SHA mismatch, or restore failure is a release failure.
- Exit 143 is never treated as success. Classify it with runner/job evidence before a single supervisor retry; do not repeatedly rerun hosted jobs until one turns green.
- If the protected reliable runner is unavailable after an infrastructure failure, mark the candidate INFRA_BLOCKED; do not publish it.
