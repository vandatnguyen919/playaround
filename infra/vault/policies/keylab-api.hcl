# keylab-api: its database role and the key that signs upload URLs.
path "secret/data/playground/keylab-db" {
  capabilities = ["read"]
}

path "secret/data/playground/keylab-upload-signing" {
  capabilities = ["read"]
}
