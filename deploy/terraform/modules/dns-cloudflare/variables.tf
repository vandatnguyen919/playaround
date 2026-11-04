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
    # MX only.
    priority = optional(number)
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.mail_records : contains(["TXT", "CNAME", "MX"], r.type)])
    error_message = "Mail records are TXT, CNAME or MX."
  }

  validation {
    condition     = alltrue([for r in var.mail_records : (r.type == "MX") == (r.priority != null)])
    error_message = "MX records need a priority; other types take none."
  }
}
