# Railway environment in Terraform

One Railway environment of the platform as code: the project, the five app services bound to the repository and
their `railway.json` config-as-code files, their variables and public domains. Decided in ADR-0010
(`docs/architecture/decisions.md`); how to apply, import an existing environment or add a staging one is in
`docs/runbooks/railway-terraform.md`. What stays by hand (Postgres and Redis templates, deploy-on-push, the first
deploy and the seed) is listed in `docs/deployment/railway.md`, "What is codified and what is not".

Nothing here holds a secret: secrets are sensitive variables supplied at apply time, and the state backend is declared
in an ignored `backend.tf` (see `backend.tf.example`). With `secrets.app_database_url` (the restricted login role's URL,
`docs/runbooks/database-roles.md`) the API and workers connect as that role and only the API's pre-deploy migration
uses the owner (`MIGRATION_DATABASE_URL`); without it every process uses the owner, as before. CI runs `terraform fmt -check` and `terraform validate`; it
never plans or applies.
