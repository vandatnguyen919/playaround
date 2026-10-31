# Terraform (Azure for Students)

Terraform v1.17.1, azurerm v5.12.0, cloudflare v5.28.1. Decisions and costs:
Deployment platform in `PRODUCT.md`. Every `apply` is a Stop: show the plan
to Dan and wait for a yes.

| Root | State | Creates |
| --- | --- | --- |
| `bootstrap/` | local, outside git | state resource group, storage account, `tfstate` container, Dan's blob role |
| `envs/azure/` | `azure.tfstate` | VNet, NSG, IP, VM, data disk, auto-shutdown, alerts, backups; Key Vault and seal key when `seal_enabled` |
| `envs/dns/` | `dns.tfstate` | `app` and `auth` A records, mail records |

## Before the first run

1. `az login`, then `az account show` is the Azure for Students subscription.
2. Check the allowed regions (Policy, Assignments, "Allowed resource
   deployment regions") and quota:
   `az vm list-usage --location centralindia -o table` (Bpsv2 family and
   regional vCPUs need at least 2).
3. Pick globally unique names for the two storage accounts (and later the
   Key Vault).

## Run order

```
cd deploy/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars      # fill in
terraform init
terraform plan -out tfplan                        # show Dan
terraform apply tfplan
terraform output -raw backend_config > ../envs/azure/backend.hcl
```

```
cd ../envs/azure
cp terraform.tfvars.example terraform.tfvars      # fill in
terraform init -backend-config=backend.hcl
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
terraform -chdir=envs/azure init -backend=false
terraform -chdir=envs/azure test
terraform fmt -recursive -check
```

`envs/azure/tests/plan.tftest.hcl` uses a mocked azurerm provider: phase 1
creates no Key Vault, phase 2 does, and a bigger VM or an operator CIDR is
rejected. It proves wiring and guard rails, not that Azure accepts the
config; the first real plan does that.

## Notes

- The data disk, both storage accounts and the Key Vault have
  `prevent_destroy`. Purge protection holds a deleted vault's name for 90
  days.
- cloud-init runs on first boot only: it formats the data disk only if it has
  no filesystem, mounts it at `/srv`, puts Docker's data there and adds a
  1 GiB swap file. Changing it does not rebuild the VM.
- Lock files hold Windows provider hashes. Add others with
  `terraform providers lock -platform=linux_amd64` if another OS runs it.
