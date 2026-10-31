variable "zone_name" {
  description = "The domain on Cloudflare, for example example.com."
  type        = string
}

variable "host_ip" {
  description = "Public IPv4 of the host (envs/azure output host_ip)."
  type        = string

  validation {
    condition     = can(cidrhost("${var.host_ip}/32", 0))
    error_message = "Use a plain IPv4 address."
  }
}

variable "host_names" {
  type    = list(string)
  default = ["app", "auth"]
}

variable "mail_records" {
  type = list(object({
    type    = string
    name    = string
    content = string
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.mail_records : contains(["TXT", "CNAME"], r.type)])
    error_message = "Mail records are TXT or CNAME."
  }
}
