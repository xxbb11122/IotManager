# Registry and Release-Evidence Retention

This document is the single operational source of truth for retention of an
approved R1 release candidate. It applies to image digests, GHCR OCI release
evidence, and the short-lived GitHub Actions copies used for diagnosis.

## Non-negotiable retention set

Keep the **current known-good release (N)** and the two preceding known-good
releases (**N-1** and **N-2**) together with their complete evidence bundles.
Each bundle must remain available for at least **180 days from the day it was
superseded**. If fewer than two newer known-good releases exist at the end of
that period, retain the candidate until the N/N-1/N-2 set is complete.

`release-manifest.json` with `status: "KNOWN_GOOD"` is the evidence index for
one bundle. It must remain paired with all of the following:

- every immutable image digest listed in `image-digests.json`;
- the release candidate, topology and service catalog;
- SBOM/provenance and per-image scan evidence;
- final Gate evidence, runtime/recovery digest evidence and checksums;
- the release manifest, its offline GitHub attestation bundle, the stage
  artifacts, and their `SHA256SUMS` entries.

Deleting any member makes the candidate ineligible for application rollback.
Do not use a mutable tag as a substitute for a retained digest.

## Registry policy

1. Configure package retention/cleanup exclusions for digests referenced by
   the N, N-1 and N-2 release manifests. Registry cleanup must not infer that
   an untagged digest is disposable.
2. Retain the full digest/evidence set for the 180-day window above; extend it
   for an incident, legal hold, active investigation, or an incomplete
   N/N-1/N-2 chain.
3. Helper tags such as `sha-<short-SHA>` may be cleaned only after an operator
   verifies that their referenced digest is still retained through its release
   manifest. Runtime, recovery and rollback tooling always use digest
   references, never helper tags.
4. Before cleanup, export the candidate IDs, source SHAs, image digests,
   evidence checksum and retention-expiry decision to the release record.
   A four-eyes DevOps/security review is required for any deletion that could
   affect an approved candidate.

## Evidence policy

The public repository cannot retain GitHub Actions artifacts for 180 days:
GitHub caps them at 90 days. Release Gate therefore publishes the signed,
checksummed `release-bundle.tar.gz` as an OCI artifact at
`ghcr.io/<owner>/<repo>/release-evidence:<candidate-id>` and records its
immutable `@sha256:<digest>` reference in the workflow summary. It immediately
pulls that digest back and verifies the archive checksum; a publication or
readback failure fails the Gate. The Actions copy is a 90-day diagnostic copy,
not the long-term source of rollback evidence.

Protect the release-evidence package, signed rollback-proof package and every
referenced image digest from cleanup
for the full N/N-1/N-2 + 180-day window. GHCR does not enforce that window by
itself: the package-retention exclusion and four-eyes cleanup review above
remain mandatory. Record the exact OCI evidence digest in each approved
release record. Do not rely on a tag after approval, and do not count a
GitHub Actions artifact as the 180-day copy.

The isolated rollback drill pulls N and N-1 evidence by their approved GHCR
digests, validates the checksums and signer attestation, and pre-pulls every
image digest before it starts. A missing N-1 image or evidence file is a
failed drill, not permission to rebuild or pull a tag.
