# DNS is applied on its own so record changes are always deliberate.
# Same state container as envs/azure, key = "dns.tfstate".
# Cloudflare auth: CLOUDFLARE_API_TOKEN (Zone DNS Edit on this zone only).

terraform {
  required_version = "~> 1.17.1"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.28.1"
    }
  }

  backend "azurerm" {}
}

provider "cloudflare" {}

module "dns" {
  source = "../../modules/dns-cloudflare"

  zone_name    = var.zone_name
  host_ip      = var.host_ip
  mail_records = var.mail_records
}
