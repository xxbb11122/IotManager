# The release Buildx catalog mirrors deploy/docker-compose.yml.  Target names
# are stable CI identifiers; image identity is always recorded by digest after
# a successful push, never by this helper tag.
variable "REGISTRY" {
  default = "ghcr.io/xxbb11122"
}

variable "TAG" {
  default = "dev"
}

variable "PLATFORM" {
  default = "linux/amd64"
}

group "release" {
  targets = ["backend", "caddy", "keycloak", "postgres", "prometheus", "alertmanager"]
}

target "release-attestations" {
  # Both attestations are attached to the pushed OCI artifact. The final
  # release identity remains the resolved registry digest, not either helper
  # tag used while Buildx publishes the image.
  attest = ["type=provenance,mode=max", "type=sbom"]
}

target "backend" {
  inherits   = ["release-attestations"]
  context    = "."
  dockerfile = "deploy/Dockerfile"
  tags       = ["${REGISTRY}/iot-manager-backend:${TAG}"]
  platforms  = ["${PLATFORM}"]
}

target "caddy" {
  inherits   = ["release-attestations"]
  context    = "."
  dockerfile = "deploy/Caddy.Dockerfile"
  tags       = ["${REGISTRY}/iot-manager-caddy:${TAG}"]
  platforms  = ["${PLATFORM}"]
}

target "keycloak" {
  inherits   = ["release-attestations"]
  context    = "deploy"
  dockerfile = "keycloak/Dockerfile"
  tags       = ["${REGISTRY}/iot-manager-keycloak:${TAG}"]
  platforms  = ["${PLATFORM}"]
}

target "postgres" {
  inherits   = ["release-attestations"]
  context    = "deploy"
  dockerfile = "postgres/Dockerfile"
  tags       = ["${REGISTRY}/iot-manager-postgres:${TAG}"]
  platforms  = ["${PLATFORM}"]
}

target "prometheus" {
  inherits   = ["release-attestations"]
  context    = "."
  dockerfile = "deploy/monitoring/Dockerfile"
  target     = "prometheus"
  tags       = ["${REGISTRY}/iot-manager-prometheus:${TAG}"]
  platforms  = ["${PLATFORM}"]
}

target "alertmanager" {
  inherits   = ["release-attestations"]
  context    = "."
  dockerfile = "deploy/monitoring/Dockerfile"
  target     = "alertmanager"
  tags       = ["${REGISTRY}/iot-manager-alertmanager:${TAG}"]
  platforms  = ["${PLATFORM}"]
}
