output "hostnames" {
  value = [for r in cloudflare_dns_record.host : r.name]
}
