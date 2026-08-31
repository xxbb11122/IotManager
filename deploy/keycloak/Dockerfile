FROM quay.io/keycloak/keycloak:26.7.2@sha256:9d1f1b2b7261ff53c66cb1092dfcdc34a5fb77e81f9e6a6e75b8b6a795de8067

USER root
COPY --chmod=0555 keycloak/entrypoint.sh /opt/keycloak/bin/iot-manager-entrypoint.sh
COPY --chmod=0555 keycloak/reconcile-keycloak-realm.sh /opt/keycloak/bin/reconcile-keycloak-realm.sh
COPY --chmod=0555 keycloak/bootstrap-owner.sh /opt/keycloak/bin/bootstrap-owner.sh
USER 1000
