# Offline checks with a mocked provider: terraform init -backend=false,
# then terraform test. No Azure credentials needed.

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      object_id = "11111111-1111-1111-1111-111111111111"
      tenant_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azurerm_linux_virtual_machine" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Compute/virtualMachines/vm-playground"
      identity = {
        principal_id = "33333333-3333-3333-3333-333333333333"
        tenant_id    = "22222222-2222-2222-2222-222222222222"
      }
    }
  }

  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Network/virtualNetworks/vnet-playground/subnets/snet-host"
    }
  }

  mock_resource "azurerm_network_security_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Network/networkSecurityGroups/nsg-playground"
    }
  }

  mock_resource "azurerm_public_ip" {
    defaults = {
      id         = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Network/publicIPAddresses/pip-playground"
      ip_address = "198.51.100.7"
    }
  }

  mock_resource "azurerm_network_interface" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Network/networkInterfaces/nic-playground"
    }
  }

  mock_resource "azurerm_managed_disk" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Compute/disks/disk-playground-data"
    }
  }

  mock_resource "azurerm_monitor_action_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Insights/actionGroups/ag-playground"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id                    = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Storage/storageAccounts/stplaygroundbktest"
      primary_blob_endpoint = "https://stplaygroundbktest.blob.core.windows.net/"
    }
  }

  mock_resource "azurerm_storage_container" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.Storage/storageAccounts/stplaygroundbktest/blobServices/default/containers/backups"
    }
  }

  mock_resource "azurerm_key_vault" {
    defaults = {
      id        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.KeyVault/vaults/kv-playground-test"
      vault_uri = "https://kv-playground-test.vault.azure.net/"
    }
  }

  mock_resource "azurerm_key_vault_key" {
    defaults = {
      resource_versionless_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-azure/providers/Microsoft.KeyVault/vaults/kv-playground-test/keys/vault-unseal"
    }
  }
}

variables {
  subscription_id             = "00000000-0000-0000-0000-000000000000"
  ssh_public_key              = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG4fq1ekQTeWsPGIlgsiGJHtbr6LA+bS5a1eE92hRNUf terraform-test-only"
  operator_ip                 = "203.0.113.10"
  alert_email                 = "ops@example.com"
  backup_storage_account_name = "stplaygroundbktest"
}

run "rejects_bigger_vm" {
  command = plan

  variables {
    vm_size = "Standard_B4ps_v2"
  }

  expect_failures = [var.vm_size]
}

run "rejects_operator_cidr" {
  command = plan

  variables {
    operator_ip = "203.0.113.0/24"
  }

  expect_failures = [var.operator_ip]
}

run "phase1_defaults" {
  command = apply

  assert {
    condition     = module.host.vm_name == "vm-playground"
    error_message = "VM name changed."
  }

  assert {
    condition     = output.key_vault_uri == null && output.seal_key_name == null
    error_message = "Phase 1 must not create the Key Vault."
  }

  assert {
    condition     = output.backup_container_url == "https://stplaygroundbktest.blob.core.windows.net/backups"
    error_message = "Backup container URL is wrong."
  }
}

run "phase2_seal_and_shutdown" {
  command = apply

  variables {
    vm_size               = "Standard_B2ps_v2"
    auto_shutdown_enabled = true
    seal_enabled          = true
    key_vault_name        = "kv-playground-test"
  }

  assert {
    condition     = output.seal_key_name == "vault-unseal"
    error_message = "Phase 2 must create the unseal key."
  }

  assert {
    condition     = output.key_vault_uri == "https://kv-playground-test.vault.azure.net/"
    error_message = "Key Vault URI missing."
  }
}
