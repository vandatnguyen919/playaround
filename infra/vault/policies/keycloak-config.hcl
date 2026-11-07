# Applies the realm: every value resolved into playground-realm.json, plus the
# client it signs in with. Not the admin user or the database password.
path "secret/data/playground/gateway-client" {
  capabilities = ["read"]
}

path "secret/data/playground/jenkins-client" {
  capabilities = ["read"]
}

path "secret/data/playground/keycloak-config-client" {
  capabilities = ["read"]
}

path "secret/data/playground/idp-google" {
  capabilities = ["read"]
}

path "secret/data/playground/idp-github" {
  capabilities = ["read"]
}

path "secret/data/playground/smtp" {
  capabilities = ["read"]
}
