# The database user Keycloak signs in as.
path "secret/data/playground/keycloak-db" {
  capabilities = ["read"]
}

# The keylab role, whose password keylab-db-init sets.
path "secret/data/playground/keylab-db" {
  capabilities = ["read"]
}
