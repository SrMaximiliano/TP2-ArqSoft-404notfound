# Random suffix: the Managed Redis name becomes part of a public DNS name, so it must be globally unique
resource "random_string" "redis_name" {
  length  = 12
  lower   = true
  upper   = false
  special = false
  numeric = true
}

# Shared storage for every VMSS node (Azure Managed Redis, PaaS)
resource "azurerm_managed_redis" "tp2_redis" {
  name                = "tp2redis${random_string.redis_name.result}"
  location            = azurerm_resource_group.tp2_resource_group.location
  resource_group_name = azurerm_resource_group.tp2_resource_group.name

  sku_name                  = var.redis_sku
  high_availability_enabled = var.redis_high_availability

  # Reachable through its public endpoint, protected by TLS + access key
  public_network_access = "Enabled"

  default_database {
    # Authenticate with an access key (the default is Entra ID only)
    access_keys_authentication_enabled = true
    # TLS only
    client_protocol = "Encrypted"
    # A single endpoint, so a plain (non-cluster) client works.
    # The default, OSSCluster, would require a cluster-aware client.
    clustering_policy = "EnterpriseCluster"
    # Account balances and rates must never be evicted
    eviction_policy = "NoEviction"
  }
}

# Write the connection data for the node app. It contains the access key,
# so the file is gitignored and only travels to the nodes inside src.zip.
resource "local_sensitive_file" "redis_config" {
  filename        = "${path.module}/node/redis.json"
  file_permission = "0600"
  content = jsonencode({
    host     = azurerm_managed_redis.tp2_redis.hostname
    port     = azurerm_managed_redis.tp2_redis.default_database[0].port
    password = azurerm_managed_redis.tp2_redis.default_database[0].primary_access_key
    tls      = true
  })
}
