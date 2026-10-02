# One Railway environment of the platform: the project, the five app services bound to the repository with their
# config-as-code files, their variables and public domains. Postgres and Redis stay Railway templates created by hand
# (the provider has no database resource); their connection strings reach the services as Railway references.
#
# Railway references such as ${{Postgres.DATABASE_URL}} are written here as "$${{...}}": "$$" is how HCL writes a
# literal "$", so the string reaches Railway unchanged and Railway resolves it.

locals {
  # Each app service with the config-as-code file Railway reads for it (build, pre-deploy, start, health, restarts).
  services = {
    api                   = { config_path = "apps/api/railway.json" }
    staff                 = { config_path = "apps/staff/railway.json" }
    portal                = { config_path = "apps/portal/railway.json" }
    "notification-worker" = { config_path = "apps/notification-worker/railway.json" }
    "integration-worker"  = { config_path = "apps/integration-worker/railway.json" }
  }
  public_services  = ["api", "staff", "portal"]
  backend_services = ["api", "notification-worker", "integration-worker"]

  # The public host of each public service: the custom domain when given, else the Railway-provided one.
  public_host = {
    for name in local.public_services :
    name => try(railway_custom_domain.public[name].domain, railway_service_domain.public[name].domain)
  }

  shared_settings = merge(
    {
      NODE_ENV        = "production"
      LOG_LEVEL       = var.log_level
      DATABASE_URL    = "$${{Postgres.DATABASE_URL}}"
      REDIS_URL       = "$${{Redis.REDIS_URL}}?family=0"
      PORTAL_BASE_URL = "https://${local.public_host.portal}"
      STAFF_BASE_URL  = "https://${local.public_host.staff}"
    },
    var.optional_settings,
  )

  api_settings = merge(
    {
      PORT         = tostring(var.api_port)
      TRUST_PROXY  = "true"
      CORS_ORIGINS = "https://${local.public_host.staff},https://${local.public_host.portal}"
    },
    var.api_settings,
  )

  web_settings = {
    NODE_ENV     = "production"
    API_BASE_URL = "http://$${{api.RAILWAY_PRIVATE_DOMAIN}}:$${{api.PORT}}/api/v1"
  }

  # Variable name per secret field; a null field creates no variable.
  shared_secret_names = {
    jwt_access_secret          = "JWT_ACCESS_SECRET"
    mfa_encryption_key         = "MFA_ENCRYPTION_KEY"
    integration_payload_key    = "INTEGRATION_PAYLOAD_KEY"
    s3_access_key_id           = "S3_ACCESS_KEY_ID"
    s3_secret_access_key       = "S3_SECRET_ACCESS_KEY"
    smtp_url                   = "SMTP_URL"
    vapid_private_key          = "VAPID_PRIVATE_KEY"
    expo_access_token          = "EXPO_ACCESS_TOKEN"
    livekit_api_key            = "LIVEKIT_API_KEY"
    livekit_api_secret         = "LIVEKIT_API_SECRET"
    otel_exporter_otlp_headers = "OTEL_EXPORTER_OTLP_HEADERS"
  }
  api_secret_names = {
    paymongo_secret_key     = "PAYMONGO_SECRET_KEY"
    paymongo_webhook_secret = "PAYMONGO_WEBHOOK_SECRET"
  }

  # Every (service, variable) pair this module manages. Keys never carry a value, so for_each stays non-sensitive.
  plain_variables = merge(
    { for pair in setproduct(local.backend_services, keys(local.shared_settings)) : "${pair[0]}/${pair[1]}" => { service = pair[0], name = pair[1], value = local.shared_settings[pair[1]] } },
    { for name, value in local.api_settings : "api/${name}" => { service = "api", name = name, value = value } },
    { for pair in setproduct(["staff", "portal"], keys(local.web_settings)) : "${pair[0]}/${pair[1]}" => { service = pair[0], name = pair[1], value = local.web_settings[pair[1]] } },
    { "staff/REALTIME_URL" = { service = "staff", name = "REALTIME_URL", value = "https://${local.public_host.api}/realtime" } },
    { "portal/PORTAL_ORGANIZATION_CODE" = { service = "portal", name = "PORTAL_ORGANIZATION_CODE", value = var.portal_organization_code } },
  )
  shared_secret_pairs = { for pair in setproduct(local.backend_services, keys(local.shared_secret_names)) : "${pair[0]}/${pair[1]}" => { service = pair[0], field = pair[1] } }
  api_secret_pairs    = { for field in keys(local.api_secret_names) : "api/${field}" => { service = "api", field = field } }
}

resource "railway_project" "this" {
  name         = var.project_name
  workspace_id = var.workspace_id
  private      = true

  default_environment = {
    name = var.environment_name
  }
}

resource "railway_service" "app" {
  for_each = local.services

  name               = each.key
  project_id         = railway_project.this.id
  source_repo        = var.source_repo
  source_repo_branch = var.source_branch
  config_path        = each.value.config_path
}

resource "railway_custom_domain" "public" {
  for_each = { for name in local.public_services : name => var.custom_domains[name] if var.custom_domains[name] != null }

  domain         = each.value
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.app[each.key].id
}

resource "railway_service_domain" "public" {
  for_each = { for name in local.public_services : name => var.service_subdomains[name] if var.custom_domains[name] == null }

  subdomain      = each.value
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.app[each.key].id
}

resource "railway_variable" "plain" {
  for_each = local.plain_variables

  name           = each.value.name
  value          = each.value.value
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.app[each.value.service].id
}

resource "railway_variable" "shared_secret" {
  for_each = { for key, pair in local.shared_secret_pairs : key => pair if nonsensitive(var.secrets[pair.field] != null) }

  name           = local.shared_secret_names[each.value.field]
  value          = var.secrets[each.value.field]
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.app[each.value.service].id
}

resource "railway_variable" "api_secret" {
  for_each = { for key, pair in local.api_secret_pairs : key => pair if nonsensitive(var.api_secrets[pair.field] != null) }

  name           = local.api_secret_names[each.value.field]
  value          = var.api_secrets[each.value.field]
  environment_id = railway_project.this.default_environment.id
  service_id     = railway_service.app[each.value.service].id
}
