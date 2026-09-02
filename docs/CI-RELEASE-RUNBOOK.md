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

## Local modes

Local development preserves the existing build-on-start behavior:

    powershell scripts/runtime/start-integration.ps1 -Mode local

Immutable mode requires the candidate's `image-digests.json`, `release-candidate.json`, `release-topology.json`, and `release-services.json` in the same evidence directory. It validates their checksums and identity before it renders the Compose image environment; it does not build or resolve mutable tags:

    bash scripts/runtime/start-integration.sh --mode immutable --digest-manifest artifacts/release/image-digests.json

For logical recovery, use the same mode and manifest. The physical WAL-G drill additionally requires its protected production-shaped environment and explicit IOT_PITR_CONFIRM=PITR.

The final gate writes `runtime-image-verification.json`. It is not a count-only report: it merges the runtime 12/12 and recovery-added 1/1 evidence, requires exactly `SVC-01` through `SVC-13`, preserves one-shot `exited(0)` observations, and rejects unknown service IDs or any expected/actual digest mismatch.

## Failure handling

- A digest mismatch, missing service observation, scan failure, checksum mismatch, source SHA mismatch, or restore failure is a release failure.
- Exit 143 is never treated as success. Classify it with runner/job evidence before a single supervisor retry; do not repeatedly rerun hosted jobs until one turns green.
- If the protected reliable runner is unavailable after an infrastructure failure, mark the candidate INFRA_BLOCKED; do not publish it.
