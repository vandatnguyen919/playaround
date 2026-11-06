output "public_ip" {
  value = azurerm_public_ip.host.ip_address
}

output "subnet_id" {
  value = azurerm_subnet.host.id
}

output "vm_id" {
  value = azurerm_linux_virtual_machine.host.id
}

output "vm_name" {
  value = azurerm_linux_virtual_machine.host.name
}

output "principal_id" {
  description = "Object ID of the VM's system-assigned managed identity."
  value       = azurerm_linux_virtual_machine.host.identity[0].principal_id
}

output "backup_alert_threshold_hours" {
  value = one(azurerm_monitor_metric_alert.backup_age.criteria).threshold
}

output "metrics_role_scope" {
  description = "Scope of the VM's metrics role, for the plan tests."
  value       = azurerm_role_assignment.host_metrics.scope
}

output "cloud_init" {
  description = "Rendered cloud-init, for the plan tests. Holds no secrets."
  value       = local.cloud_init
}

output "admin_username" {
  value = var.admin_username
}
