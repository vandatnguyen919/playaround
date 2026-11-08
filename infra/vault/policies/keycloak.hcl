# Keycloak itself: its database, and the bootstrap admin user and client it
# creates on first boot. The realm's client secrets go through keycloak-config.
path "secret/data/playground/keycloak-admin" {
  capabilities = ["read"]
}

path "secret/data/playground/keycloak-config-client" {
  capabilities = ["read"]
}

path "secret/data/playground/keycloak-db" {
  capabilities = ["read"]
}
