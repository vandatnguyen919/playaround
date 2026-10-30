terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

data "cloudflare_zone" "this" {
  filter = {
    name = var.zone_name
  }
}

# DNS only (not proxied): TLS ends at Traefik and Keycloak sees one hop.
resource "cloudflare_dns_record" "host" {
  for_each = toset(var.host_names)

  zone_id = data.cloudflare_zone.this.zone_id
  name    = "${each.value}.${var.zone_name}"
  type    = "A"
  content = var.host_ip
  ttl     = 300
  proxied = false
}

# Mail authentication (Brevo code, DKIM CNAMEs, SPF, DMARC), as given by the
# provider. Names are relative to the zone; "@" is the apex.
resource "cloudflare_dns_record" "mail" {
  for_each = { for r in var.mail_records : "${r.type} ${r.name} ${r.content}" => r }

  zone_id = data.cloudflare_zone.this.zone_id
  name    = each.value.name == "@" ? var.zone_name : "${each.value.name}.${var.zone_name}"
  type    = each.value.type
  content = each.value.content
  ttl     = 3600
  proxied = false
}
