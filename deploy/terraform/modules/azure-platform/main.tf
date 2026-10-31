terraform {
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
    }
  }
}

data "azurerm_client_config" "current" {}

# Backups: pg_dump (phase 1), Barman Cloud and Vault snapshots (phase 2).
# Reachable only from the host subnet and Dan's IP; no shared keys.
resource "azurerm_storage_account" "backups" {
  name                            = var.backup_storage_account_name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  access_tier                     = "Hot"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  default_to_oauth_authentication = true
  tags                            = var.tags

  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = [var.host_subnet_id]
    ip_rules                   = [var.operator_ip]
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "backups" {
  name                  = "backups"
  storage_account_id    = azurerm_storage_account.backups.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "backups" {
  storage_account_id = azurerm_storage_account.backups.id

  rule {
    name    = "expire-backups"
    enabled = true

    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["${azurerm_storage_container.backups.name}/"]
    }

    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = var.backup_retention_days
      }
    }
  }
}

resource "azurerm_role_assignment" "host_backups" {
  scope                = azurerm_storage_container.backups.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.host_principal_id
}

# Lets Dan download backups (runway rule) without shared keys.
resource "azurerm_role_assignment" "operator_backups" {
  scope                = azurerm_storage_container.backups.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Phase 2: Vault auto-unseal. Nothing below exists until seal_enabled = true.
resource "azurerm_key_vault" "seal" {
  count = var.seal_enabled ? 1 : 0

  name                       = var.key_vault_name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  tags                       = var.tags

  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [var.host_subnet_id]
    ip_rules                   = [var.operator_ip]
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Owner has no key data rights in RBAC mode; Terraform needs them to create
# the key. Role assignments can take a few minutes to apply: if the key
# fails with 403 on the first apply, run apply again.
resource "azurerm_role_assignment" "operator_seal" {
  count = var.seal_enabled ? 1 : 0

  scope                = azurerm_key_vault.seal[0].id
  role_definition_name = "Key Vault Crypto Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_key" "seal" {
  count = var.seal_enabled ? 1 : 0

  name         = "vault-unseal"
  key_vault_id = azurerm_key_vault.seal[0].id
  key_type     = "RSA"
  key_size     = 2048
  key_opts     = ["wrapKey", "unwrapKey"]

  depends_on = [azurerm_role_assignment.operator_seal]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_role_assignment" "host_seal" {
  count = var.seal_enabled ? 1 : 0

  scope                = azurerm_key_vault_key.seal[0].resource_versionless_id
  role_definition_name = "Key Vault Crypto User"
  principal_id         = var.host_principal_id
}
