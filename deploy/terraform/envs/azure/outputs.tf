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

output "key_vault_uri" {
  value = module.platform.key_vault_uri
}

output "seal_key_name" {
  value = module.platform.seal_key_name
}
