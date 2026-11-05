# Terraform (Azure for Students)

Terraform v1.17.1, azurerm v5.12.0, cloudflare v5.28.1. Decisions and costs:
Deployment platform in `PRODUCT.md`. Every `apply` is a Stop: show the plan
to Dan and wait for a yes.

| Root | State | Creates |
| --- | --- | --- |
| `bootstrap/` | local, outside git | state resource group, storage account, `tfstate` container, Dan's blob role |
| `envs/azure/` | `azure.tfstate` | VNet, NSG, IP, VM, data disk, auto-shutdown, alerts, cost budget, backups; Key Vault and seal key when `seal_enabled` |
| `envs/dns/` | `dns.tfstate` | `app` and `auth` A records, mail records |

## Authentication

Dan's own user through `az login`: both the provider and the backend use the
Azure CLI session (`use_cli`), and the backend reads state with Entra ID
(`use_azuread_auth`). There is no service principal, client secret or storage
key anywhere. Locking is a blob lease on the state file, which the azurerm
backend takes by itself.

## Before the first run

1. Install Terraform 1.17.1 (the code refuses other minor versions) from
   https://releases.hashicorp.com/terraform/1.17.1/ and check it against
   `SHA256SUMS` (winget stops at 1.16.6), and the Azure CLI:
   `winget install Microsoft.AzureCLI`.
2. `az login`, then `az account show` is the Azure for Students subscription.
3. Check the allowed regions (Policy, Assignments, "Allowed resource
   deployment regions") and quota:
   `az vm list-usage --location southeastasia -o table` (Bpsv2 family and
   regional vCPUs need at least 2).
4. Pick globally unique names for the two storage accounts (and later the
   Key Vault).
5. Register the resource providers azurerm 5 does not register by itself. A new
   subscription fails the apply with `MissingSubscriptionRegistration` otherwise:
   `az provider register -n Microsoft.DevTestLab --wait` and
   `az provider register -n Microsoft.Insights --wait`.

## Run order

```
cd deploy/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars      # fill in
terraform init
terraform plan -out tfplan                        # show Dan
terraform apply tfplan
terraform output -raw backend_config > ../envs/azure/backend.hcl
```

The bootstrap state stays on this machine and is not backed up. If `init`
below gets a 403, the blob role has not propagated yet: wait a few minutes.

Try the budget on its own first. It is free and starts no meter, so this shows
whether the offer accepts it before anything billable exists:

```
cd ../envs/azure
cp terraform.tfvars.example terraform.tfvars      # fill in
terraform init -backend-config=backend.hcl
terraform plan -target='module.platform.azurerm_consumption_budget_subscription.monthly[0]' -out tfplan   # show Dan
terraform apply tfplan
```

If Azure refuses it, set `budget_enabled = false`; the weekly balance check in
`PRODUCT.md` then stands alone. Either way, the full plan:

```
terraform plan -out tfplan                        # show Dan
terraform apply tfplan
```

DNS, on its own, after the domain is on Cloudflare
(`CLOUDFLARE_API_TOKEN` with Zone DNS Edit on that zone only):

```
cd ../dns
sed 's/azure.tfstate/dns.tfstate/' ../azure/backend.hcl > backend.hcl
cp terraform.tfvars.example terraform.tfvars      # host_ip from: terraform -chdir=../azure output -raw host_ip
terraform init -backend-config=backend.hcl
terraform plan -out tfplan                        # show Dan
terraform apply tfplan
```

## Phase 2

In `envs/azure/terraform.tfvars`: `vm_size = "Standard_B2ps_v2"`,
`auto_shutdown_enabled = true`, `seal_enabled = true` and a `key_vault_name`.
The resize deallocates and restarts the VM; disks and IP stay. If the seal key
fails with 403, the Crypto Officer role has not propagated yet: apply again.

## Checks without Azure

```
bash deploy/terraform/check.sh
```

Needs Docker only, and CI runs the same script. It runs `fmt`, `init` against
the lock files, `validate`, `terraform test`, `tflint` (`.tflint.hcl`) and
`trivy config`, each from a pinned image. Accepted Trivy findings are ignored
inline next to their resource, or in `.trivyignore.yaml` when they apply to
every storage account.

The tests in `bootstrap/tests` and `envs/azure/tests` use a mocked azurerm
provider: state storage settings and backend auth; phase 1 creates no Key
Vault, phase 2 does; the budget is on by default and can be turned off; and a
bigger VM, an operator CIDR or a bad budget value is rejected. They prove
wiring and guard rails, not that Azure accepts the config, and not lease
locking; the first real plan and apply do that.

## Notes

- The data disk, both storage accounts, their containers and the Key Vault
  have `prevent_destroy`. Purge protection holds a deleted vault's name for 90
  days.
- The budget is $45 a month and only warns. In another region or phase, set
  `budget_amount` from the cost table in `PRODUCT.md`.
- cloud-init runs on first boot only; changing it does not rebuild the VM. It
  hardens SSH (key only, `AllowUsers`, local forwarding only), turns on `ufw`
  with the NSG's rules, fail2ban and unattended upgrades (with a reboot at
  20:00 UTC when a kernel fix needs one), and installs Docker.
- `data-disk.service` waits for LUN 0, because Terraform attaches the disk after
  the VM exists. It formats the disk only if it has nothing on it, mounts it at
  `/srv` and adds a 1 GiB swap file. Docker's data is there and Docker will not
  start without it.
- Published Docker ports skip ufw's INPUT rules, so a `DOCKER-USER` chain in
  `/etc/ufw/after.rules` drops everything from outside except 80 and 443.
  k3s (phase 2) needs this firewall revisited.

## When your IP changes

Port 22 is limited twice, by the NSG and by `ufw`. Move both. SSH is closed by
then, so the second step goes through the VM agent:

```
# in envs/azure: set operator_ip in terraform.tfvars
terraform plan -out tfplan                        # show Dan
terraform apply tfplan
az vm run-command invoke -g rg-playground-azure -n vm-playground \
  --command-id RunShellScript --scripts "/usr/local/sbin/set-operator-ip <new-ip>"
```

## Rebuilding the VM

The data disk and the public IP stay. The attachment, the auto-shutdown schedule
and anything tied to the VM's identity are rebuilt with it:

```
terraform plan -replace='module.host.azurerm_linux_virtual_machine.host' -out tfplan   # show Dan
terraform apply tfplan
```
- Lock files hold Windows and Linux amd64 provider hashes. Add others with
  `terraform providers lock -platform=<os_arch>` if another OS runs it.
