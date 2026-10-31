variable "subscription_id" {
  description = "Azure for Students subscription ID (az account show --query id -o tsv)."
  type        = string
}

variable "location" {
  description = "Region; must be on the subscription's allowed regions list."
  type        = string
  default     = "centralindia"
}

variable "state_storage_account_name" {
  description = "Globally unique, 3 to 24 lowercase letters and digits, for example stplaygroundtf<4 random>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.state_storage_account_name))
    error_message = "Use 3 to 24 lowercase letters and digits."
  }
}
