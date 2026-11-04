variable "subscription_id" {
  type = string
}

variable "location" {
  description = "Must be on the subscription's allowed regions list."
  type        = string
  default     = "southeastasia"
}

variable "vm_size" {
  description = "Standard_B2pls_v2 in phase 1, Standard_B2ps_v2 in phase 2."
  type        = string
  default     = "Standard_B2pls_v2"

  validation {
    condition     = contains(["Standard_B2pls_v2", "Standard_B2ps_v2"], var.vm_size)
    error_message = "Only Standard_B2pls_v2 or Standard_B2ps_v2 are in the plan; a bigger size is a Stop."
  }
}

variable "ssh_public_key" {
  type = string
}

variable "operator_ip" {
  description = "Dan's public IPv4 (SSH, Blob and Key Vault firewalls)."
  type        = string

  validation {
    condition     = can(cidrhost("${var.operator_ip}/32", 0))
    error_message = "Use a plain IPv4 address, no prefix."
  }
}

variable "alert_email" {
  type = string
}

variable "auto_shutdown_enabled" {
  type    = bool
  default = false
}

variable "auto_shutdown_timezone" {
  type    = string
  default = "SE Asia Standard Time"
}

variable "backup_storage_account_name" {
  type = string
}

variable "seal_enabled" {
  type    = bool
  default = false
}

variable "key_vault_name" {
  type    = string
  default = null
}

variable "budget_enabled" {
  description = "Create the Cost Management budget. Set false if the subscription's offer refuses it."
  type        = bool
  default     = true
}

variable "budget_amount" {
  description = "USD a month. Raise it with the region or phase; see the cost table in PRODUCT.md."
  type        = number
  default     = 45

  validation {
    condition     = var.budget_amount > 0 && var.budget_amount <= 100
    error_message = "Use more than 0 and at most 100, the yearly credit."
  }
}

variable "budget_start_date" {
  description = "YYYY-MM-01, the current month or later."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{4}-(0[1-9]|1[0-2])-01$", var.budget_start_date))
    error_message = "Use the first of a month, as YYYY-MM-01."
  }
}
