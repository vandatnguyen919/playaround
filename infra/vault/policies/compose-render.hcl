# vault.mjs render: only what infra/docker-compose.yml takes from infra/.env.
# Read only, and not the secrets that exist for compose.prod.yml alone.
path "secret/data/playground/gateway-client" {
  capabilities = ["read"]
}

path "secret/data/playground/jenkins-client" {
  capabilities = ["read"]
}

path "secret/data/playground/redis" {
  capabilities = ["read"]
}

path "secret/data/playground/keycloak-admin" {
  capabilities = ["read"]
}

path "secret/data/playground/idp-google" {
  capabilities = ["read"]
}

path "secret/data/playground/idp-github" {
  capabilities = ["read"]
}
