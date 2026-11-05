output "host_ip" {
  value = module.host.public_ip
}

output "ssh" {
  value = "ssh ${module.host.admin_username}@${module.host.public_ip}"
}

output "vm_name" {
  value = module.host.vm_name
}

output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "vm_principal_id" {
  value = module.host.principal_id
}

output "backup_container_url" {
  value = module.platform.backup_container_url
}

output "backup_retention_days" {
  value = module.platform.backup_retention_days
}

output "backup_reader_scope" {
  value = module.platform.backup_reader_scope
}

output "backup_alert_threshold_hours" {
  value = module.host.backup_alert_threshold_hours
}

output "metrics_role_scope" {
  value = module.host.metrics_role_scope
}

output "key_vault_uri" {
  value = module.platform.key_vault_uri
}

output "seal_key_name" {
  value = module.platform.seal_key_name
}

output "budget_name" {
  value = module.platform.budget_name
}
