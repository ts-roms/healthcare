# Railway environments with Terraform

How to apply `infrastructure/terraform/railway/` (ADR-0010): first apply, importing the environment that exists, and
adding a staging environment. What the module manages and what stays by hand: `docs/deployment/railway.md`, "What is
codified and what is not". Nothing below is run by CI; the person applying holds the Railway token.

## Before the first apply

1. **Token.** A Railway account or workspace token with access to the project, in `RAILWAY_TOKEN` of the shell that
   runs Terraform. Never in a file.
2. **State backend.** Copy `backend.tf.example` to `backend.tf` (ignored by git) and fill in the remote backend the
   organization controls, encrypted at rest and restricted to the people who apply: state holds every variable value
   the module manages, secrets included. Local state is not acceptable for an environment with patient data.
3. **Inputs.** Copy `terraform.tfvars.example` to `terraform.tfvars` (ignored) for the non-secret inputs. Supply the
   secrets through the environment, never a file in the repository:

   ```sh
   export TF_VAR_secrets='{"jwt_access_secret":"...","mfa_encryption_key":"...","integration_payload_key":"..."}'
   export TF_VAR_api_secrets='{}'
   ```

   Generate each one per environment (`openssl rand -base64 48` for the JWT secret, `openssl rand -base64 32` for
   the two keys; they must differ). Optional secrets (S3, SMTP, VAPID, Expo, LiveKit, OTLP headers, PayMongo) are set
   when the service is adopted; a missing entry sets no variable.

4. `terraform init` downloads the provider from the Terraform registry and writes `.terraform.lock.hcl`; keep that
   lock file with the state owner's working copy (it is ignored in the repository because this repository cannot
   produce a registry-verified one).

## Importing the environment that already exists

The module must not create a second project. Import the existing one, then let `plan` show the differences:

```sh
terraform import railway_project.this <project id>
terraform import 'railway_service.app["api"]' <service id>          # one per service
terraform import 'railway_service_domain.public["api"]' <project id>:production:<host>.up.railway.app
terraform import 'railway_variable.plain["api/PORT"]' <project id>:production:PORT   # one per variable
terraform plan
```

Ids come from the dashboard or the Railway CLI. Variables that `plan` would create already exist in Railway only if
they were set by hand with the same name: import those too, or let Terraform set them (same value, a redeploy).
Variables the dashboard holds that the module does not know (`SEED_*` after the seed, experiments) are not touched
by Terraform; remove them by hand or add them to `optional_settings` / `api_settings`.

A `plan` that wants to replace a service or the project is wrong: stop and check the import. Changing a variable
redeploys that service (provider behaviour); plan during a quiet hour.

## Applying

```sh
terraform plan -out=plan.out   # read every line: services, domains, variables
terraform apply plan.out
```

Postgres and Redis are created by hand from Railway's templates before the first apply, named `Postgres` and
`Redis`, so the `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}` references the module sets resolve. After
the first apply: turn deploy-on-push off per service, deploy in the order in `railway.md` and run the one-time seed.
For a custom domain, create the DNS records from the `custom_domain_dns` output.

## A staging environment

Run the same module from a second working directory with its own `backend.tf` key, `terraform.tfvars`
(`project_name = "healthcare-staging"`, `source_branch = "develop"`, its own subdomains) and secrets. Separate
project, separate databases, separate secrets; nothing is shared with production.

## What never goes in the repository

Tokens, `terraform.tfvars`, `backend.tf`, state, plan files. The module's `.gitignore` covers them; `git status`
before every commit.
