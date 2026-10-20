FROM quay.io/keycloak/keycloak:26.7.5@sha256:37dbaf6f0722c9ec246335f36e1ef8b2e6cb960f7c27e0d8c615121a3d475a85

USER root
COPY --chmod=0555 keycloak/entrypoint.sh /opt/keycloak/bin/iot-manager-entrypoint.sh
COPY --chmod=0555 keycloak/reconcile-keycloak-realm.sh /opt/keycloak/bin/reconcile-keycloak-realm.sh
COPY --chmod=0555 keycloak/bootstrap-owner.sh /opt/keycloak/bin/bootstrap-owner.sh
USER 1000
