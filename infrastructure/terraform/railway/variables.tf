# ---- What the environment is ---------------------------------------------------------------------------------------

variable "project_name" {
  description = "Name of the Railway project."
  type        = string
}

variable "workspace_id" {
  description = "Railway workspace the project belongs to. Required when the token can reach several workspaces."
  type        = string
  default     = null
}

variable "environment_name" {
  description = "Name of the project's default environment (Railway creates it with the project)."
  type        = string
  default     = "production"
}

variable "source_repo" {
  description = "GitHub repository every service deploys from, as owner/name."
  type        = string
  default     = "ts-roms/healthcare"
}

variable "source_branch" {
  description = "Branch the services deploy from. Deploy-on-push is turned off by hand per service (docs/deployment/railway.md)."
  type        = string
  default     = "main"
}

# ---- Domains -------------------------------------------------------------------------------------------------------

variable "custom_domains" {
  description = <<-EOT
    Custom domains for the public services, when the organization owns them (DNS records come out as outputs). A
    service without one gets a Railway-provided domain from `service_subdomains`.
  EOT
  type = object({
    api    = optional(string)
    staff  = optional(string)
    portal = optional(string)
  })
  default = {}
}

variable "service_subdomains" {
  description = "Railway-provided subdomains (<subdomain>.up.railway.app) for public services without a custom domain."
  type = object({
    api    = optional(string, "healthcare-api")
    staff  = optional(string, "healthcare-staff")
    portal = optional(string, "healthcare-portal")
  })
  default = {}
}

# ---- Settings ------------------------------------------------------------------------------------------------------

variable "api_port" {
  description = "The port the API listens on. Set explicitly so the staff and portal services can reference it."
  type        = number
  default     = 8080
}

variable "portal_organization_code" {
  description = "The organization's code the patient portal serves (the seed's SEED_ORG_CODE)."
  type        = string
  default     = "demo"
}

variable "log_level" {
  description = "LOG_LEVEL of the API and workers."
  type        = string
  default     = "log"
}

variable "optional_settings" {
  description = <<-EOT
    Non-secret optional settings shared by the API and both workers, by variable name (for example OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FORCE_PATH_STYLE, EMAIL_FROM, VAPID_PUBLIC_KEY, VAPID_SUBJECT,
    EXPO_PUSH_ENABLED, LIVEKIT_URL, FHIR_BASE_URL, PAYMONGO_PAYMENT_METHODS, CLAMAV_HOST, CLAMAV_PORT). Values are plain strings; see
    docs/deployment/railway.md for each one.
  EOT
  type        = map(string)
  default     = {}
}

variable "api_settings" {
  description = "Non-secret settings of the API only (DATABASE_POOL_MAX, FHIR_BASE_URL, PAYMONGO_PAYMENT_METHODS, ...)."
  type        = map(string)
  default     = {}
}

# ---- Secrets: supplied at apply time, never written to a file in the repository ------------------------------------

variable "secrets" {
  description = <<-EOT
    Secrets shared by the API and both workers (docs/deployment/railway.md, "Shared"). Generated per environment;
    supplied through a .tfvars file outside the repository, TF_VAR_secrets, or the backend's variable store. A null
    entry sets nothing.
  EOT
  type = object({
    jwt_access_secret          = string
    mfa_encryption_key         = string
    integration_payload_key    = string
    s3_access_key_id           = optional(string)
    s3_secret_access_key       = optional(string)
    smtp_url                   = optional(string)
    vapid_private_key          = optional(string)
    expo_access_token          = optional(string)
    livekit_api_key            = optional(string)
    livekit_api_secret         = optional(string)
    otel_exporter_otlp_headers = optional(string)
  })
  sensitive = true

  validation {
    condition     = length(var.secrets.jwt_access_secret) >= 32
    error_message = "jwt_access_secret must be at least 32 characters."
  }
  validation {
    condition     = var.secrets.mfa_encryption_key != var.secrets.integration_payload_key
    error_message = "integration_payload_key must be a key separate from mfa_encryption_key."
  }
}

variable "api_secrets" {
  description = "Secrets of the API only: PayMongo (online payment in MyHealth). A null entry sets nothing."
  type = object({
    paymongo_secret_key     = optional(string)
    paymongo_webhook_secret = optional(string)
  })
  sensitive = true
  default   = {}
}
