# Offline checks with a mocked provider: terraform init, then terraform test.
# No Azure credentials needed.

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      object_id = "11111111-1111-1111-1111-111111111111"
      tenant_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-tfstate/providers/Microsoft.Storage/storageAccounts/stplaygroundtftest"
    }
  }

  mock_resource "azurerm_storage_container" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-playground-tfstate/providers/Microsoft.Storage/storageAccounts/stplaygroundtftest/blobServices/default/containers/tfstate"
    }
  }
}

variables {
  subscription_id            = "00000000-0000-0000-0000-000000000000"
  state_storage_account_name = "stplaygroundtftest"
}

run "rejects_bad_storage_name" {
  command = plan

  variables {
    state_storage_account_name = "Not-Valid"
  }

  expect_failures = [var.state_storage_account_name]
}

run "state_storage" {
  command = apply

  assert {
    condition     = azurerm_storage_account.state.blob_properties[0].versioning_enabled
    error_message = "State blobs must be versioned."
  }

  assert {
    condition     = azurerm_storage_account.state.blob_properties[0].delete_retention_policy[0].days == 30
    error_message = "State blobs need soft delete."
  }

  assert {
    condition     = !azurerm_storage_account.state.shared_access_key_enabled
    error_message = "Shared key access must stay off."
  }

  assert {
    condition     = azurerm_storage_container.state.name == "tfstate" && azurerm_storage_container.state.container_access_type == "private"
    error_message = "The state container must be private and named tfstate."
  }

  assert {
    condition     = azurerm_role_assignment.operator_state.role_definition_name == "Storage Blob Data Contributor" && azurerm_role_assignment.operator_state.principal_id == "11111111-1111-1111-1111-111111111111"
    error_message = "The signed-in user needs blob data rights on the container."
  }

  assert {
    condition     = strcontains(output.backend_config, "use_azuread_auth     = true") && strcontains(output.backend_config, "use_cli              = true")
    error_message = "The backend must use Azure AD auth through the CLI."
  }
}
