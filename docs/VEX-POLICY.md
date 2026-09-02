# VEX Policy

The default image policy is fail closed: HIGH, CRITICAL, scanner errors, and missing scan evidence fail a release.

An exception belongs in security/vex/ as JSON or a simple YAML record and must include:

    schemaVersion: 1
    cve: CVE-YYYY-NNNN
    artifact: IMG-R03
    imageDigest: sha256:...
    status: affected-but-accepted
    reason: upstream-no-fix
    compensatingControls:
      - internal-network-only
    approvedBy: security-owner
    approvedAt: 2026-09-02T00:00:00Z
    expiresAt: 2026-10-02T00:00:00Z
    trackingIssue: SEC-123

The validator requires exact artifact and digest matches, an active approval period, compensating controls, an approver, and a tracking issue. Expired or malformed entries immediately revert to failure.
