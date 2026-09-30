# Module boundaries

Enforced by `@nx/enforce-module-boundaries` in the root `eslint.config.mjs` (root `CLAUDE.md` §4). A violation fails `nx lint`, and therefore CI.

## Tags

Every project declares two tags in its `package.json`:

```json
"nx": { "tags": ["scope:shared", "type:ui"] }
```

A project with no matching tag may not depend on anything, so **every new project must be tagged**.

### `type:*` — layer

Lower layers never import higher ones.

```
app → feature → ui → data-access → contract → domain → util
```

| Tag                | Holds                                                  | May depend on                                    |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| `type:app`         | Deployable apps (`apps/*`)                             | feature, ui, data-access, contract, domain, util |
| `type:feature`     | Screens and workflows composed from lower layers       | feature, ui, data-access, contract, domain, util |
| `type:ui`          | Presentational components (`libs/ui`)                  | ui, contract, domain, util                       |
| `type:data-access` | API clients, repositories, application services        | data-access, contract, domain, util              |
| `type:contract`    | A domain's public API: DTOs, commands, queries, events | contract, domain, util                           |
| `type:domain`      | Entities, value objects, domain rules (`libs/domain`)  | domain, util                                     |
| `type:util`        | Framework-free helpers                                 | util                                             |

### `scope:*` — ownership

| Tag                                    | May depend on                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `scope:shared`                         | `scope:shared`                                                                 |
| `scope:staff`, `scope:portal`          | its own scope, `scope:shared`, any clinical domain scope                       |
| `scope:mobile`                         | `type:domain` libraries only (platform-neutral; today `@healthcare/domain`)    |
| `scope:<domain>` (e.g. `scope:clinic`) | its own scope, `scope:shared`, and **any `type:contract` lib**                 |
| `scope:api`                            | its own scope, `scope:shared`, any clinical domain scope (composition root)    |
| `scope:worker`                         | its own scope, `scope:shared`, `scope:interoperability` (integration adapters) |

Clinical domains are `patient`, `clinic`, `laboratory`, `dental`, `telemedicine`, `care-plan`, `prescription`, `billing`, `inventory`, `interoperability`, `notification`, `audit` and `documents` (`DOMAIN_SCOPES` in `eslint.config.mjs`).

So a domain reaches another domain **only through that domain's contract library**:

```
GOOD  libs/clinic-data-access (scope:clinic, type:data-access) → libs/laboratory-contract (scope:laboratory, type:contract)
BAD   libs/clinic-data-access (scope:clinic, type:data-access) → libs/laboratory-core     (scope:laboratory, type:domain)
BAD   libs/clinic-domain      (scope:clinic, type:domain)      → libs/laboratory-contract  (domain layer may not call contracts)
```

Cross-domain calls belong in a domain's `data-access` or `feature` layer, not in its entities.

Backend platform services (`core`, `audit`, `organization`, `auth`, `documents`, `notification`) are `scope:shared` so
every domain can use them. Where a platform service needs domain data (e.g. notification needs a patient's mobile
number), it defines a **port** implemented by an adapter in `apps/api` rather than importing the domain.

## Current projects

| Project                                                                                       | Tags                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/staff`                                                                                  | `scope:staff`, `type:app`                |
| `apps/portal`                                                                                 | `scope:portal`, `type:app`               |
| `apps/mobile` (Expo; API client)                                                              | `scope:mobile`, `type:app`               |
| `apps/api`                                                                                    | `scope:api`, `type:app`                  |
| `apps/e2e` (imports no workspace project; drives the built apps through the browser and HTTP) | `scope:e2e`, `type:e2e`                  |
| `libs/ui`                                                                                     | `scope:shared`, `type:ui`                |
| `libs/domain`                                                                                 | `scope:shared`, `type:domain`            |
| `libs/core`, `libs/audit`, `libs/organization`, `libs/documents`, `libs/notification`         | `scope:shared`, `type:data-access`       |
| `libs/auth`                                                                                   | `scope:shared`, `type:feature`           |
| `libs/patient`                                                                                | `scope:patient`, `type:feature`          |
| `libs/clinic`                                                                                 | `scope:clinic`, `type:feature`           |
| `libs/prescription`                                                                           | `scope:prescription`, `type:feature`     |
| `libs/laboratory`                                                                             | `scope:laboratory`, `type:feature`       |
| `libs/telemedicine`                                                                           | `scope:telemedicine`, `type:feature`     |
| `libs/care-plan`                                                                              | `scope:care-plan`, `type:feature`        |
| `libs/billing`                                                                                | `scope:billing`, `type:feature`          |
| `libs/inventory`                                                                              | `scope:inventory`, `type:feature`        |
| `libs/dental`                                                                                 | `scope:dental`, `type:feature`           |
| `libs/pdf`                                                                                    | `scope:shared`, `type:util`              |
| `libs/interoperability`                                                                       | `scope:interoperability`, `type:feature` |
| `libs/philhealth`                                                                             | `scope:interoperability`, `type:feature` |

`libs/philhealth` is one adapter family of the interoperability layer (same scope): it depends on
`libs/interoperability` (outbound exchanges), never the reverse. The composition roots (`apps/api`,
`apps/integration-worker`) wire it in.

## Adding a clinical domain library

1. Create `libs/<name>/package.json` with `nx.tags`: `scope:<domain>` and one `type:*`.
2. If the scope is new, add it to `DOMAIN_SCOPES` in `eslint.config.mjs` and to the table above.
3. Add `libs/<name>/eslint.config.mjs` extending the root config (see `libs/domain/eslint.config.mjs`). Nx then infers the `lint` target.
4. Expose anything other domains need through a `type:contract` library.
