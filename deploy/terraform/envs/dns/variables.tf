variable "zone_name" {
  type = string
}

variable "host_ip" {
  description = "terraform -chdir=../azure output -raw host_ip"
  type        = string
}

variable "mail_records" {
  type = list(object({
    type    = string
    name    = string
    content = string
  }))
  default = []
}
