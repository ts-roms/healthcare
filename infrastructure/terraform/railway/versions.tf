# Railway environment for the platform (ADR-0010, docs/runbooks/railway-terraform.md).
#
# State: production state must live in a remote backend the organization controls, never in the repository. The
# backend is declared outside this file (backend.tf, ignored by git; see backend.tf.example) so that this module
# makes no choice of backend and holds no credentials.
terraform {
  required_version = ">= 1.6"

  required_providers {
    railway = {
      # Community-maintained provider (MPL-2.0; terraform-community-providers/terraform-provider-railway), verified
      # 2026-10-02 for the items this module manages. Not an official Railway product.
      source  = "terraform-community-providers/railway"
      version = "~> 0.6.2"
    }
  }
}

# Authenticates with the RAILWAY_TOKEN environment variable (an account or workspace token), never a value in a file.
provider "railway" {}
