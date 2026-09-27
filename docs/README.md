# Documentation

| Folder              | Contents                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| `architecture/`     | System architecture, module boundaries, ADRs (`architecture/adr/NNNN-title.md`) |
| `domains/`          | One document per domain, from `domains/_template.md`                            |
| `database/`         | Schema overview, migrations policy, retention/archival rules                    |
| `api/`              | API conventions, error format, versioning, generated OpenAPI                    |
| `security/`         | RBAC model, access scopes, audit, secrets, data privacy                         |
| `interoperability/` | External integrations, spec sources and versions, `dependencies.md`             |
| `deployment/`       | Environments, infrastructure, CI/CD                                             |
| `runbooks/`         | Operational procedures, incident response, backup/restore                       |

Project-wide engineering rules live in the root `CLAUDE.md`; domain rules in `libs/<domain>/CLAUDE.md`.
