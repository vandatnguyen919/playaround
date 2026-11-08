# vault.mjs seed and rotate: writes secrets under the app's prefix, and reads
# them to merge. No delete and no destroy, so old versions stay in KV history.
path "secret/data/playground/*" {
  capabilities = ["create", "update", "read"]
}
