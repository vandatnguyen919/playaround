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

output "admin_username" {
  value = var.admin_username
}
