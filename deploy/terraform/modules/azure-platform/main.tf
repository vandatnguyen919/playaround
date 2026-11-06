terraform {
  required_version = "~> 1.17.1"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.12.0"
    }
  }
}

data "azurerm_client_config" "current" {}

# Backups: pg_dump (phase 1), Barman Cloud and Vault snapshots (phase 2).
# Reachable only from the host subnet and Dan's IP; no shared keys.
resource "azurerm_storage_account" "backups" {
  name                              = var.backup_storage_account_name
  resource_group_name               = var.resource_group_name
  location                          = var.location
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = "LRS"
  infrastructure_encryption_enabled = true
  access_tier                       = "Hot"
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  shared_access_key_enabled         = false
  allow_nested_items_to_be_public   = false
  default_to_oauth_authentication   = true
  tags                              = var.tags

  # The VM's identity can delete blobs ("Data Contributor" has no write-only
  # form). A deleted blob stays restorable this long, so a stolen identity or a
  # script bug cannot wipe the backups at once.
  blob_properties {
    delete_retention_policy {
      days = 7
    }
  }

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

  lifecycle {
    prevent_destroy = true
  }
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

# Free. Tracks cost before credits for the whole subscription, so anything
# outside this env counts too. It only warns: nothing stops at the threshold.
# Microsoft's docs disagree on whether Azure for Students supports budgets, so
# budget_enabled = false is the way out if the API refuses it.
# 80% actual fires late in a normal month ($36 of about $42). That mail is the
# proof the budget sees cost; if none arrives, rely on the weekly balance check.
resource "azurerm_consumption_budget_subscription" "monthly" {
  count = var.budget_enabled ? 1 : 0

  name            = "budget-playground-monthly"
  subscription_id = "/subscriptions/${var.subscription_id}"
  amount          = var.budget_amount
  time_grain      = "Monthly"

  time_period {
    start_date = "${var.budget_start_date}T00:00:00Z"
  }

  notification {
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = [var.alert_email]
  }

  notification {
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = [var.alert_email]
  }

  notification {
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Forecasted"
    contact_emails = [var.alert_email]
  }
}
