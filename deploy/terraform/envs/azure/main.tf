terraform {
  required_version = "~> 1.17.1"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.12.0"
    }
  }

  # Partial config: terraform init -backend-config=backend.hcl
  # (values from the bootstrap output backend_config, key = "azure.tfstate").
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  subscription_id     = var.subscription_id
  use_cli             = true
  storage_use_azuread = true
}

locals {
  tags = {
    project = "playground"
    env     = "azure"
  }
}

resource "azurerm_resource_group" "this" {
  name     = "rg-playground-azure"
  location = var.location
  tags     = local.tags
}

module "host" {
  source = "../../modules/azure-host"

  name                   = "playground"
  resource_group_name    = azurerm_resource_group.this.name
  location               = azurerm_resource_group.this.location
  vm_size                = var.vm_size
  ssh_public_key         = var.ssh_public_key
  operator_ip            = var.operator_ip
  auto_shutdown_enabled  = var.auto_shutdown_enabled
  auto_shutdown_timezone = var.auto_shutdown_timezone
  alert_email            = var.alert_email
  tags                   = local.tags
}

module "platform" {
  source = "../../modules/azure-platform"

  resource_group_name         = azurerm_resource_group.this.name
  location                    = azurerm_resource_group.this.location
  host_subnet_id              = module.host.subnet_id
  host_principal_id           = module.host.principal_id
  operator_ip                 = var.operator_ip
  backup_storage_account_name = var.backup_storage_account_name
  seal_enabled                = var.seal_enabled
  key_vault_name              = var.key_vault_name
  tags                        = local.tags
}
