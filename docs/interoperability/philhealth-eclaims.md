# PhilHealth eClaims — adapter stubs

| Item                        | Value                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| External system             | PhilHealth eClaims                                                                                |
| Specification               | **Not obtained.** No message format, transport, codes or validation rules are modelled.           |
| Status                      | **Dependency** — adapter port and an unconfigured adapter; claims are prepared, never transmitted |
| Accreditation/certification | None claimed                                                                                      |
| Code                        | `libs/interoperability/src/lib/philhealth`, `apps/api/src/app/adapters/philhealth-adapters.ts`    |
| Migration                   | `0021_philhealth_claims.sql`                                                                      |

Root `CLAUDE.md` §36: never invent government APIs or rules. What exists is everything the platform needs **around**
an eClaims exchange, so that a real adapter can be added once the official specification and credentials are obtained,
without touching billing or clinical code.

## What exists

- **Claim package** (`claim-package.ts`) — a format-neutral, internal model (`model: "platform-claim-1"`) of what the
  platform can assemble for one issued invoice with PhilHealth coverage: member identity and PhilHealth PIN, facility
  accreditation number, amount claimed, service period, ICD-10 coded diagnoses of the billed encounters, invoice lines
  and totals. It is not the eClaims format; an adapter maps it.
- **Readiness checks** — of the platform's own data only: invoice issued, a PhilHealth coverage line, the patient's PIN
  (identifier `philhealth_pin`) recorded, the facility's accreditation number recorded and covering the service dates,
  an ICD-10 coded diagnosis on a billed encounter. PhilHealth's own rules (eligibility, benefit packages, case rates,
  filing windows, required attachments) are **not** modelled.
- **Gateway port** (`gateway.ts`) — `PhilHealthClaimsGateway.submitClaim(claim, idempotencyKey)` returning
  `accepted` (with the external reference) / `rejected` (reasons) / `failed` (retryable or not) / `not_configured`,
  plus `specification` (system, status, version). The default `UnconfiguredPhilHealthGateway` has status
  `dependency` and transmits nothing.
- **Facility accreditation** — `philhealth_facility_accreditation`: the number as issued (with optional validity dates),
  recorded by staff, versioned and audited; not verified with PhilHealth.
- **Exchange log** — `integration_exchange`: one row per outbound operation with an idempotency key (unique per
  organization and system), status (`queued` → `accepted` / `rejected` / `failed` / `not_configured`), attempts,
  external reference, returned reason codes, last error, and a SHA-256 **digest** of the prepared package. The PHI
  payload itself is never stored.

## Flow

```
Staff (philhealth.claim.submit) ── GET  /api/v1/philhealth/claims/invoices/{id}      → checks + package (PIN masked) + submissions
                                └─ POST /api/v1/philhealth/claims/invoices/{id}/submissions {idempotencyKey}
                                        │ refused (422 integration_not_configured) while the gateway's status is "dependency"
                                        │ refused (422 claim_not_ready) with the failing checks
                                        │ refused (409 claim_already_submitted) while one is queued or accepted
                                        ▼
                  integration_exchange (queued, digest) + audit + PhilHealthClaimSubmissionRequested  — one transaction
                                        ▼ outbox (at-least-once)
                  PhilHealthSubmissions → PhilHealthClaimsService.process
                     rebuild the package; if its digest differs from the request's → failed (data changed; prepare again)
                     gateway.submitClaim(package, idempotencyKey)
                       accepted  → exchange accepted + external reference → billing coverage line "submitted" with the reference
                       rejected  → exchange rejected with the reason codes
                       failed    → retried by the outbox (up to 5 attempts) unless not retryable → failed
```

Billing never learns about PhilHealth formats: the API adapter records the acknowledgement through
`InvoiceService.recordIntegrationClaimSubmitted` (attributed to the requesting user, audited as the system). While
eClaims is not connected, staff file the claim through PhilHealth's own channel and record the reference with the
existing claim follow-up on the invoice (submitted / settled / denied).

## Permissions

| Permission                   | Roles              | Allows                                               |
| ---------------------------- | ------------------ | ---------------------------------------------------- |
| `philhealth.claim.submit`    | org_admin, cashier | Prepare a claim (preview) and request its submission |
| `philhealth.settings.manage` | org_admin          | Record a facility's accreditation number             |

Audit actions: `philhealth.claim.preview`, `philhealth.claim.submit-request`, `philhealth.claim.exchange` (system),
`philhealth.accreditation.record`, and billing's `billing.claim.status`.

## Screens

Staff invoice page (issued, with PhilHealth coverage): **PhilHealth claim** panel — "eClaims not connected" notice,
the checklist (icon + text), the prepared claim (PIN masked), earlier submissions; the submit button appears only when a
connected adapter is configured. Billing settings: **PhilHealth accreditation** of the selected facility.

## To implement a real adapter (when the specification is obtained)

1. Record the specification source, version and contact in [dependencies.md](dependencies.md).
2. Implement `PhilHealthClaimsGateway` in an adapter (mapping `PhilHealthClaimPackage` to the official format,
   transport, credentials from secrets management), idempotent per key; set `specification.status`.
3. Move processing to `apps/integration-worker` (BullMQ, backoff, dead-letter) so external calls never run in the API's
   outbox relay; keep `integration_exchange` as the log. Store full payloads only in protected storage if required.
4. Add the specification's own validation, eligibility and claim-status operations as further ports.
5. Validate against PhilHealth's test environment before any production use; do not claim accreditation until granted.
