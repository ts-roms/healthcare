# API conventions

- Base path `/api/v1/…` (URI versioning). OpenAPI UI at `/api/docs` outside production.
- JSON only; request bodies up to 1 MB. Files go directly to object storage via presigned URLs.

## Headers

| Header | Direction | Meaning |
| --- | --- | --- |
| `Authorization: Bearer <access token>` | request | Required unless the route is public |
| `X-Facility-Id` | request | Facility the caller is acting in. Required by facility-bound actions (e.g. registration); scopes facility-level role grants |
| `X-Department-Id` | request | Department context (requires `X-Facility-Id`) |
| `Idempotency-Key` | request | 8–128 chars; makes POST/PUT/PATCH/DELETE safe to retry for 24 h |
| `X-Request-Id` | both | Correlation id; generated if absent, always echoed |
| `Idempotent-Replayed: true` | response | The response is a stored replay |

## Errors

```json
{ "error": { "code": "possible_duplicates", "message": "…", "details": { }, "requestId": "…" } }
```

| Status | Typical codes |
| --- | --- |
| 400 | `validation_failed` (details: `[{ path, message }]`), `facility_required` |
| 401 | `unauthenticated`, `invalid_credentials`, `account_locked`, `session_ended`, `invalid_token` |
| 403 | `forbidden` (the denial is audited) |
| 404 | `not_found` (also used for records of other organizations — existence is not revealed) |
| 409 | `conflict`, `version_conflict`, `possible_duplicates`, `identifier_in_use`, `organization_selection_required` |
| 422 | business rule violations, e.g. `invalid_contact`, `upload_missing`, `idempotency_key_reused` |
| 429 | `rate_limited` |

## Pagination

`?page=1&pageSize=25` (max 100). Responses: `{ items, page, pageSize, hasMore }`.
No total counts (avoids expensive `COUNT(*)` on large tables).

## Concurrency

Editable resources return `version`. Updates must send the version they read;
a stale version fails with `409 version_conflict`.

## Minimum necessary

List and search endpoints return summaries (e.g. patient search masks the
mobile number and omits identifiers and addresses). Full records come from the
detail endpoint, which is audited as a view.

## Phase 1 endpoints

| Area | Endpoints |
| --- | --- |
| Health | `GET /health/live`, `GET /health/ready` |
| Auth | `POST /auth/login`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`, `/auth/password`, `/auth/mfa/{setup,confirm,disable}`, `GET /auth/me` |
| Users & roles | `GET/POST /users`, `GET /users/:id`, `PATCH /users/:id/membership`, `POST/DELETE /users/:id/role-assignments[/:id]`, `GET/POST /roles`, `GET /permissions` |
| Organization | `POST /organizations` (platform admin), `GET /organization`, `GET/POST /facilities`, `GET/PATCH /facilities/:id`, `GET/POST /facilities/:id/departments` |
| Patients | `GET /patients` (lookup), `POST /patients/duplicate-check`, `POST /patients`, `GET/PATCH /patients/:id`, `POST /patients/:id/status`, `POST /patients/:id/{contacts,addresses,identifiers,relationships}`, `DELETE /patients/:id/:collection/:recordId`, `GET/POST /patients/:id/consents`, `PUT /patients/:id/communication-preferences` |
| Documents | `POST /documents`, `POST /documents/:id/complete`, `GET /documents?patientId=`, `GET /documents/:id`, `GET /documents/:id/download-url`, `POST /documents/:id/archive` |
| Notifications | `POST /notifications`, `GET /notifications?patientId=`, `GET /me/notifications`, `POST /me/notifications/:id/read` |
| Audit | `GET /audit-events` |
