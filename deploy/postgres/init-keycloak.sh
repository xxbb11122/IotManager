#!/bin/sh
set -eu

# This script runs only while PostgreSQL initializes an empty data volume.
# psql variables quote identifiers and password values safely.
psql --set=keycloak_database="$KEYCLOAK_DB_DATABASE" \
  --set=keycloak_username="$KEYCLOAK_DB_USERNAME" \
  --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE USER :"keycloak_username" WITH ENCRYPTED PASSWORD :'keycloak_password';
CREATE DATABASE :"keycloak_database" OWNER :"keycloak_username";
SQL
