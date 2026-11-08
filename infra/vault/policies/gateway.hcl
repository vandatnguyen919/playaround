# The BFF: its OIDC client secret and its Redis password. Nothing else.
path "secret/data/playground/gateway-client" {
  capabilities = ["read"]
}

path "secret/data/playground/redis" {
  capabilities = ["read"]
}
