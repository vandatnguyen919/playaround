output "backend_config" {
  description = "Paste into envs/<env>/backend.hcl, changing key per root."
  value       = <<-EOT
    tenant_id            = "${data.azurerm_client_config.current.tenant_id}"
    subscription_id      = "${var.subscription_id}"
    resource_group_name  = "${azurerm_resource_group.state.name}"
    storage_account_name = "${azurerm_storage_account.state.name}"
    container_name       = "${azurerm_storage_container.state.name}"
    key                  = "azure.tfstate"
    use_azuread_auth     = true
    use_cli              = true
  EOT
}
