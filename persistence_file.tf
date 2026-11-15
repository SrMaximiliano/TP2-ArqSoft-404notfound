resource "random_string" "storage_suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_storage_account" "state_storage" {
  name                     = "rdtstate${random_string.storage_suffix.result}"
  resource_group_name      = var.ssh_key_group_name
  location                 = var.region
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_share" "state_share" {
  name                 = "state"
  storage_account_id   = azurerm_storage_account.state_storage.id
  quota                = 3
}

resource "local_file" "ansible_storage_vars" {
  content = yamlencode({
    storage_account_name = azurerm_storage_account.state_storage.name
    storage_account_key  = azurerm_storage_account.state_storage.primary_access_key
    storage_share_name   = azurerm_storage_share.state_share.name
  })
  filename = "${path.module}/ansible/storage_vars.yml"
}