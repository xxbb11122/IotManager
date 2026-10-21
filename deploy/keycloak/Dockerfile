FROM quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244

USER root
COPY --chmod=0555 keycloak/entrypoint.sh /opt/keycloak/bin/iot-manager-entrypoint.sh
COPY --chmod=0555 keycloak/reconcile-keycloak-realm.sh /opt/keycloak/bin/reconcile-keycloak-realm.sh
COPY --chmod=0555 keycloak/bootstrap-owner.sh /opt/keycloak/bin/bootstrap-owner.sh
USER 1000
