output "backup_container_url" {
  value = "${azurerm_storage_account.backups.primary_blob_endpoint}${azurerm_storage_container.backups.name}"
}

output "key_vault_uri" {
  value = var.seal_enabled ? azurerm_key_vault.seal[0].vault_uri : null
}

output "seal_key_name" {
  value = var.seal_enabled ? azurerm_key_vault_key.seal[0].name : null
}
