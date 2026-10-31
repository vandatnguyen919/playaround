variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "host_subnet_id" {
  description = "Subnet with Microsoft.Storage and Microsoft.KeyVault service endpoints."
  type        = string
}

variable "host_principal_id" {
  description = "Object ID of the VM's managed identity."
  type        = string
}

variable "operator_ip" {
  description = "Dan's public IPv4, allowed through the Blob and Key Vault firewalls."
  type        = string
}

variable "backup_storage_account_name" {
  description = "Globally unique, 3 to 24 lowercase letters and digits."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.backup_storage_account_name))
    error_message = "Use 3 to 24 lowercase letters and digits."
  }
}

variable "backup_retention_days" {
  type    = number
  default = 14
}

variable "seal_enabled" {
  description = "Phase 2: create the Key Vault and unseal key for Vault."
  type        = bool
  default     = false
}

variable "key_vault_name" {
  description = "Globally unique, 3 to 24 letters, digits and hyphens. Held for 90 days after a delete (purge protection)."
  type        = string
  default     = null

  validation {
    condition     = var.key_vault_name == null || can(regex("^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$", var.key_vault_name))
    error_message = "Use 3 to 24 letters, digits and hyphens, starting with a letter."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
