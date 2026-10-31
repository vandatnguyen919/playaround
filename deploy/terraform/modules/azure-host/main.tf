terraform {
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
    }
  }
}

resource "azurerm_virtual_network" "this" {
  name                = "vnet-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = ["10.20.0.0/16"]
  tags                = var.tags
}

# Service endpoints let azure-platform lock Blob and Key Vault to this subnet.
resource "azurerm_subnet" "host" {
  name                 = "snet-host"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.20.1.0/24"]

  service_endpoint {
    service = "Microsoft.Storage"
  }

  service_endpoint {
    service = "Microsoft.KeyVault"
  }
}

resource "azurerm_network_security_group" "host" {
  name                = "nsg-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  security_rule {
    name                       = "http-https"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "ssh-operator"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.operator_ip
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "host" {
  subnet_id                 = azurerm_subnet.host.id
  network_security_group_id = azurerm_network_security_group.host.id
}

resource "azurerm_public_ip" "host" {
  name                = "pip-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Standard"
  allocation_method   = "Static"
  tags                = var.tags
}

resource "azurerm_network_interface" "host" {
  name                = "nic-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.host.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.host.id
  }
}

resource "azurerm_linux_virtual_machine" "host" {
  name                            = "vm-${var.name}"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  size                            = var.vm_size
  admin_username                  = var.admin_username
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.host.id]
  custom_data                     = base64encode(file("${path.module}/cloud-init.yaml"))
  tags                            = var.tags

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    name                 = "osdisk-${var.name}"
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 32
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server-arm64"
    version   = "latest"
  }

  identity {
    type = "SystemAssigned"
  }

  boot_diagnostics {}

  # cloud-init runs once; edits to it should not rebuild the VM.
  lifecycle {
    ignore_changes = [custom_data, source_image_reference]
  }
}

# Separate from the VM so the VM can be rebuilt without losing data.
resource "azurerm_managed_disk" "data" {
  name                 = "disk-${var.name}-data"
  resource_group_name  = var.resource_group_name
  location             = var.location
  storage_account_type = "StandardSSD_LRS"
  create_option        = "Empty"
  disk_size_gb         = var.data_disk_size_gb
  tags                 = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_virtual_machine_data_disk_attachment" "data" {
  managed_disk_id    = azurerm_managed_disk.data.id
  virtual_machine_id = azurerm_linux_virtual_machine.host.id
  lun                = 0
  caching            = "ReadOnly"
}

resource "azurerm_dev_test_global_vm_shutdown_schedule" "nightly" {
  virtual_machine_id    = azurerm_linux_virtual_machine.host.id
  location              = var.location
  enabled               = var.auto_shutdown_enabled
  daily_recurrence_time = var.auto_shutdown_time
  timezone              = var.auto_shutdown_timezone
  tags                  = var.tags

  notification_settings {
    enabled = false
  }
}

resource "azurerm_monitor_action_group" "operator" {
  name                = "ag-${var.name}"
  resource_group_name = var.resource_group_name
  short_name          = "playground"
  tags                = var.tags

  email_receiver {
    name                    = "operator"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

# A drained credit bank means a stuck build or a crash loop.
resource "azurerm_monitor_metric_alert" "cpu_credits" {
  name                = "alert-${var.name}-cpu-credits"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_linux_virtual_machine.host.id]
  description         = "CPU credits remaining under 50"
  severity            = 2
  frequency           = "PT15M"
  window_size         = "PT1H"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "CPU Credits Remaining"
    aggregation      = "Minimum"
    operator         = "LessThan"
    threshold        = 50
  }

  action {
    action_group_id = azurerm_monitor_action_group.operator.id
  }
}

# Off while auto-shutdown is on, or it would fire every night.
resource "azurerm_monitor_metric_alert" "availability" {
  name                = "alert-${var.name}-availability"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_linux_virtual_machine.host.id]
  description         = "VM not available"
  severity            = 1
  enabled             = !var.auto_shutdown_enabled
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "VmAvailabilityMetric"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.operator.id
  }
}
