# Creates the storage account that holds every env's remote state.
# Local state on purpose (it cannot store itself); keep terraform.tfstate
# out of git. Run once, by Dan, after `az login`.

terraform {
  required_version = "~> 1.17.1"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.12.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id     = var.subscription_id
  use_cli             = true
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}

locals {
  tags = {
    project = "playground"
    purpose = "tfstate"
  }
}

resource "azurerm_resource_group" "state" {
  name     = "rg-playground-tfstate"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "state" {
  name                            = var.state_storage_account_name
  resource_group_name             = azurerm_resource_group.state.name
  location                        = azurerm_resource_group.state.location
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  default_to_oauth_authentication = true
  tags                            = local.tags

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

# Subscription Owner has no blob data rights; the azurerm backend needs them.
resource "azurerm_role_assignment" "operator_state" {
  scope                = azurerm_storage_container.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}
