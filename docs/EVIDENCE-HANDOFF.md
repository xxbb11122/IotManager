# Evidence Handoff and Trusted Producers

Every release stage records the same immutable candidate fields:

- releaseCandidateId
- sourceSha
- topologySha256
- manifestSha256
- requested and checked-out source SHA
- producer repository, run, attempt, job, workflow Raw Ref, workflow SHA, workflow path, and canonical workflow identity

Raw workflow_ref is an audit reference and may end in refs/heads or refs/tags. It is not immutable. The trusted identity is recomputed as:

    repository/workflow-path@40-character-workflow-SHA

The final gate verifies the artifact checksum before reading its contents, then checks repository, allowed event, allowed workflow path, SHA syntax, recomputed identity, candidate equality, and exact producer run fields. It never accepts a latest-success artifact.

For same-repository candidates, caller and producer workflow SHA must equal sourceSha. A fallback workflow with a different SHA requires an explicitly approved canonical identity and protected dispatch policy.
