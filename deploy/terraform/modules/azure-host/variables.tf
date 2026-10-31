variable "name" {
  description = "Short name used in every resource name."
  type        = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "vm_size" {
  description = "B2pls_v2 (4 GiB) for phase 1, B2ps_v2 (8 GiB) for phase 2. Anything bigger is a Stop."
  type        = string

  validation {
    condition     = contains(["Standard_B2pls_v2", "Standard_B2ps_v2"], var.vm_size)
    error_message = "Only Standard_B2pls_v2 or Standard_B2ps_v2 are in the plan."
  }
}

variable "admin_username" {
  type    = string
  default = "playground"
}

variable "ssh_public_key" {
  description = "OpenSSH public key for the admin user."
  type        = string
}

variable "operator_ip" {
  description = "Dan's public IPv4, the only source allowed on port 22."
  type        = string

  validation {
    condition     = can(cidrhost("${var.operator_ip}/32", 0))
    error_message = "Use a plain IPv4 address, no prefix."
  }
}

variable "data_disk_size_gb" {
  type    = number
  default = 64
}

variable "auto_shutdown_enabled" {
  description = "Nightly stop and deallocate. Off in phase 1, on in phase 2."
  type        = bool
  default     = false
}

variable "auto_shutdown_time" {
  description = "HHmm in auto_shutdown_timezone."
  type        = string
  default     = "0100"
}

variable "auto_shutdown_timezone" {
  description = "Windows time zone ID."
  type        = string
  default     = "SE Asia Standard Time"
}

variable "alert_email" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
