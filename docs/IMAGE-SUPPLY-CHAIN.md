# Immutable Image Supply Chain

The approved release topology is generated from the candidate's resolved Compose configuration:

| Boundary | Required count |
| --- | ---: |
| Release artifacts | 8 |
| Buildable artifacts | 6 |
| Normal runtime services | 12 |
| Recovery-added service | 1 (wal-g-recovery) |
| Release candidate service union | 13 |

deploy/docker-bake.hcl mirrors the six Compose build contexts. Build output is published to GHCR under a helper SHA tag, then the release identity is captured as repository@sha256.

image-digests.json is the immutable manifest. image-digests.env is rendered from that manifest and consumed only by deploy/docker-compose.immutable.yml plus the recovery-only overlay. Immutable launch uses Docker Compose no-build; immutable one-shot recovery uses Compose run with pull-never.

The artifact catalog is fixed:

- IMG-R01 Backend
- IMG-R02 Caddy
- IMG-R03 Keycloak
- IMG-R04 PostgreSQL / WAL-G
- IMG-R05 Prometheus
- IMG-R06 Alertmanager
- IMG-R07 logical backup base image
- IMG-R08 Alpine one-shot initializers

Every image is scanned by exact digest. Local image IDs, latest, and helper tags are never accepted as final release evidence.
