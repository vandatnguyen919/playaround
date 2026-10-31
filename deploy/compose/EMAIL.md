# Real email (production)

Keycloak sends verify-email and reset-password mail. Dev sends to Mailpit
(`infra/docker-compose.yml` sets the `SMTP_*` values for keycloak-config).
Production sends through OCI Email Delivery with the `SMTP_*` values from
`deploy/compose/.env`. Both apply the same `infra/playground-realm.json`,
whose `smtpServer` block is all `$(env:SMTP_*)` placeholders.

`<domain>` below is the sending domain, the part after `@` in `SMTP_FROM`.

## 1. OCI (console, home region)

1. Identity & Security, Domains, your domain, Users: create a user
   `smtp-sender` with no console password. Add it to a group `smtp-senders`.
2. Policy in the root compartment:
   `Allow group smtp-senders to use email-family in tenancy`
3. On that user: SMTP credentials, Generate. Copy the username and password
   now; the password is shown once. These are `SMTP_USER` and `SMTP_PASSWORD`.
4. Developer Services, Email Delivery, Email Domains: create `<domain>`.
   In it, Add DKIM with selector `playground-202610` (a new selector per key
   rotation, for example by date). OCI shows a CNAME name and value.
5. Approved Senders: add `no-reply@<domain>` (the `SMTP_FROM`).
6. Email Delivery, Configuration: note the SMTP endpoint
   (`smtp.email.<region>.oci.oraclecloud.com`). This is `SMTP_HOST`.

Always Free: 3,000 mails a month, 10 a minute, 10 approved senders.

## 2. DNS (Cloudflare, all "DNS only")

| Type | Name | Value |
| --- | --- | --- |
| TXT | `<domain>` | `v=spf1 include:<continent>.rp.oracleemaildelivery.com ~all` |
| CNAME | `playground-202610._domainkey.<domain>` | the value OCI showed in step 4 |
| TXT | `_dmarc.<domain>` | `v=DMARC1; p=none; rua=mailto:<reporting address>` |

- SPF host by region: `rp.oracleemaildelivery.com` (Americas),
  `ap.rp.oracleemaildelivery.com` (Asia Pacific),
  `eu.rp.oracleemaildelivery.com` (Europe). Keep one SPF record only; merge
  into it if one exists.
- DMARC reports: Cloudflare's DMARC Management (free) gives a `rua` address
  and shows the reports. Start with `p=none`. After a week of reports that
  show only OCI passing, change to `p=quarantine`.
- Wait until OCI shows the DKIM key as Active (it checks the CNAME).

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
password form). Save each original (Gmail: More, Show original, Download
Original) and run:

```
node deploy/compose/mailcheck.mjs headers verify.eml reset.eml
node deploy/compose/mailcheck.mjs cleanup     # needs the admin SSH tunnel
```

`headers` reads the topmost `Authentication-Results` (the mailbox's own
verdict) and needs `spf=pass`, `dkim=pass` signed by `<domain>` (not only by
OCI's domain), and `dmarc=pass`.

For a local stack (`auth.localhost`, self-signed cert) add `--insecure` and
`PUBLIC_IP=127.0.0.1`.
