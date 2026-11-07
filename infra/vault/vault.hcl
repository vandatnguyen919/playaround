# Local Vault: one node, integrated Raft, the storage phase 2 uses. Sealed with
# Shamir here; phase 2 replaces that with the azurekeyvault seal (PRODUCT.md).
ui            = true
disable_mlock = true # Raft recommends it, and the container needs no IPC_LOCK.

storage "raft" {
  path    = "/vault/file"
  node_id = "local-1"
}

# Plain HTTP: compose publishes this on loopback only.
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr     = "http://127.0.0.1:8200"
cluster_addr = "http://vault:8201"
