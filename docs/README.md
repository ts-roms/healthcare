# Documentation

| Folder              | Contents                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `manual/`           | [User manual](manual/README.md) for staff and patients: how to use each screen, by task and role                              |
| `architecture/`     | [Overview](architecture/overview.md), module boundaries, [decisions](architecture/decisions.md)                               |
| `domains/`          | One document per domain, from `domains/_template.md` (patient, identity-access, organization, audit, documents, notification) |
| `database/`         | Schema overview, migrations policy, retention/archival rules                                                                  |
| `api/`              | API conventions, error format, versioning, generated OpenAPI                                                                  |
| `security/`         | RBAC model, access scopes, audit, secrets, data privacy, [compliance dependencies](security/compliance-dependencies.md)       |
| `interoperability/` | External integrations, spec sources and versions, `dependencies.md`                                                           |
| `deployment/`       | Environments, infrastructure, CI/CD                                                                                           |
| `runbooks/`         | Operational procedures, incident response, backup/restore                                                                     |

Project-wide engineering rules live in the root `CLAUDE.md`; domain rules in `libs/<domain>/CLAUDE.md`.
