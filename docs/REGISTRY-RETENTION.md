# Registry Retention

Do not delete a digest referenced by an in-flight release candidate. Retain candidate image digests, SBOM/provenance, scan reports, image manifest, stage handoffs, and final evidence for at least the release evidence retention period.

Helper tags such as sha-short-SHA may be cleaned only after verifying that the referenced digest remains retained. Runtime and recovery always use immutable digest references, never the helper tag.
