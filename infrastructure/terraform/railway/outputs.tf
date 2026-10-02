output "project_id" {
  description = "Railway project id."
  value       = railway_project.this.id
}

output "environment_id" {
  description = "Id of the environment the services run in."
  value       = railway_project.this.default_environment.id
}

output "service_ids" {
  description = "Railway service id per app service."
  value       = { for name, service in railway_service.app : name => service.id }
}

output "public_hosts" {
  description = "Public host of each public service (custom or Railway-provided)."
  value       = local.public_host
}

output "custom_domain_dns" {
  description = "DNS records to create for each custom domain: the CNAME target and the ownership verification record."
  value = {
    for name, domain in railway_custom_domain.public : name => {
      domain                    = domain.domain
      dns_record_value          = domain.dns_record_value
      verification_host_label   = domain.verification_host_label
      verification_record_value = domain.verification_record_value
    }
  }
}
