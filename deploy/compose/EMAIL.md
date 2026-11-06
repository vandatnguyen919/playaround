# Real email (production)

Keycloak sends verify-email and reset-password mail. Dev sends to Mailpit
(`infra/docker-compose.yml` sets the `SMTP_*` values for keycloak-config).
Production sends through Resend SMTP with the `SMTP_*` values from
`deploy/compose/.env`. Both apply the same `infra/playground-realm.json`,
whose `smtpServer` block is all `$(env:SMTP_*)` placeholders.

`<domain>` below is the sending domain, the part after `@` in `SMTP_FROM`.

## 1. Resend (free plan)

1. Sign up at resend.com. The free plan includes SMTP.
2. Domains, Add Domain: enter `<domain>`. Pick the region closest to the
   server. Resend shows the DNS records for step 2.
3. Leave open and click tracking off (the default). Check the domain's
   Configuration tab. Tracking would rewrite the links in the mail and send
   the action tokens through a tracker.
4. API Keys, Create API Key: name `playground-keycloak`, permission Sending
   access, limited to `<domain>`. Copy it now; it is shown once. This is
   `SMTP_PASSWORD`. `SMTP_USER` is the word `resend`. The host is
   `smtp.resend.com`, port 587.

Limits on the free plan: 100 mails a day (UTC), 3,000 a month, 3 domains, 10
requests a second. The API key stays out of Terraform (it would land in state).

## 2. DNS (Cloudflare, all "DNS only")

Use the values Resend shows. Their shape:

| Type | Name | Value |
| --- | --- | --- |
| MX | `<return-path host>` | `feedback-smtp.<region>.amazonses.com`, priority 10 |
| TXT | `<return-path host>` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey.<domain>` | `p=<key>` |
| TXT | `_dmarc.<domain>` | `v=DMARC1; p=none; rua=mailto:<reporting address>` |

- The return-path host is the one Resend shows: `send.<domain>` in its docs,
  `rsend.<domain>` for `tickin.me`. Put it in `MAIL_SPF_HOST`. The `Return-Path`
  of a delivered mail confirms it.
- SPF lives on that host, so any SPF record on `<domain>` itself (Cloudflare
  Email Routing, for example) stays as it is. DMARC passes through DKIM signed
  by `<domain>`, and through SPF, since the host is aligned with it.
- DMARC reports: Cloudflare's DMARC Management (free) gives a `rua` address
  and shows the reports. Start with `p=none`. After a week of reports that
  show only Resend passing, change to `p=quarantine`.
- Once Terraform runs, these go in `mail_records` of
  `deploy/terraform/envs/dns` instead of the dashboard.
- In Resend, click Verify on the domain and wait until it shows Verified.

Check from any machine:

```
node deploy/compose/mailcheck.mjs dns
```

## 3. Keycloak

Fill the `SMTP_*` and `MAIL_*` values in `.env`, then apply the realm:

```
docker compose -f deploy/compose/compose.prod.yml up keycloak-config
```

## 4. Verify delivery

```
node deploy/compose/mailcheck.mjs send you@gmail.com
```

It registers `you+mailcheck-<time>@gmail.com` and asks for a reset, so two
mails go out, and checks the Keycloak log for send errors. Keycloak shows
"You should receive an email" even when a reset mail fails (it must not tell
which emails exist), so the log and the mailbox are the real proof.

In the mailbox: both mails are in the inbox (not spam), and both links work
(the verify link activates the account, the reset link opens the new
password form). The verify link lasts 5 minutes and the reset link 15. Save
each original (Gmail: More, Show original, Download
Original) and run:

```
node deploy/compose/mailcheck.mjs headers verify.eml reset.eml
node deploy/compose/mailcheck.mjs cleanup     # needs the admin SSH tunnel
```

`headers` reads the topmost `Authentication-Results` (the mailbox's own
verdict) and needs `spf=pass`, `dkim=pass` signed by `<domain>` (not only by
Resend's domain), and `dmarc=pass`. It also needs every link to go straight to
`AUTH_HOST`: another host means click tracking is on.

For a local stack (`auth.localhost`, self-signed cert) add `--insecure` and
`PUBLIC_IP=127.0.0.1`.

On the VM the `.env` stays there, so give `send` and `headers` a file holding only
the public values (`AUTH_HOST`, `APP_HOST`, `SMTP_FROM`) with `--env-file`, read
the Keycloak log over SSH, and clean up with
`node deploy/compose/smoke-public.mjs playground@<vm> mail-cleanup`.
