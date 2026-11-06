output "backup_container_url" {
  value = "${azurerm_storage_account.backups.primary_blob_endpoint}${azurerm_storage_container.backups.name}"
}

output "backup_retention_days" {
  value = azurerm_storage_management_policy.backups.rule[0].actions[0].base_blob[0].delete_after_days_since_creation_greater_than
}

output "backup_reader_scope" {
  description = "Scope of the VM's blob role, for the plan tests."
  value       = azurerm_role_assignment.host_backups.scope
}

output "key_vault_uri" {
  value = var.seal_enabled ? azurerm_key_vault.seal[0].vault_uri : null
}

output "seal_key_name" {
  value = var.seal_enabled ? azurerm_key_vault_key.seal[0].name : null
}

output "budget_name" {
  value = one(azurerm_consumption_budget_subscription.monthly[*].name)
}
