# Runner Reliability and Recovery

Heavy image builds begin on GitHub-hosted runners. Keep a rolling sample of at least 20 valid heavy-job runs (or all valid runs in the last 14 days until that threshold is reached) and record P50, P95, maximum duration, cache hit rate, infrastructure failure rate, and runner shutdown count.

Use the protected larger or ephemeral self-hosted runner when the same candidate has two confirmed infrastructure terminations, heavy hosted infrastructure failure exceeds 5%, the P95 control window repeatedly exceeds target with a platform signal, GitHub reports a runner incident, or the release manager escalates risk.

The original terminated job cannot retry itself. A separate supervisor must classify failure using job conclusion, cancellation, timeout, runner-shutdown evidence, process errors, and expected artifacts. Unknown evidence is INCOMPLETE, not infrastructure success. If a reliable runner is unavailable, the result is INFRA_BLOCKED.

## Machine-readable supervisor inputs

`image-security.yml` writes two independent artifacts after the build matrix:

- `image-build-classification.json` records the non-success classification. A `143` is never converted to PASS.
- `image-build-retry-manifest.json` preserves only build results with a valid JSON checksum, matching candidate/source/topology identity, and an immutable digest. Its `retryArtifacts` list is the only permitted input to a retry; already valid image digests must not be rebuilt.

The tooling can capture and evaluate the rolling hosted-runner window without changing release evidence:

```bash
bash scripts/ci/record-runner-sample.sh \
  --output artifacts/runner/samples/run-123.json \
  --run-id 123 --run-attempt 1 --workload image-security \
  --runner-class github-hosted --status PASS --duration-seconds 1200

bash scripts/ci/evaluate-runner-reliability.sh \
  --samples-dir artifacts/runner/samples \
  --output artifacts/runner/runner-metrics.json
```

The evaluator uses the newest 20 hosted samples, or the last 14 days when fewer are available. It emits `RELIABLE_RUNNER_REQUIRED` for two infrastructure failures of one candidate, a >5% failure rate in a full 20-sample window, or a P95 over the configured target accompanied by shutdown evidence. The protected fallback must consume the same candidate, topology checksum, and frozen manifest; otherwise the gate stays blocked.
