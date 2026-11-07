# Sign-in to Jenkins through Keycloak. Its deploy credentials are not in Vault yet.
path "secret/data/playground/jenkins-client" {
  capabilities = ["read"]
}
