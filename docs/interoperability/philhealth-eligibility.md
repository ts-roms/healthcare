# PhilHealth eligibility — adapter stubs

| Item            | Value                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| External system | PhilHealth member eligibility                                                                             |
| Specification   | **Not obtained.** No inquiry format, transport, result codes, membership categories or rules are modelled |
| Status          | **Dependency** — recorded checks, a format-neutral inquiry, the port and an unconfigured adapter          |
| Code            | `libs/interoperability/src/lib/philhealth/eligibility*.ts`, staff patient record                          |
| Migration       | `0024_philhealth_eligibility.sql`                                                                         |

Root `CLAUDE.md` §36: never invent government APIs or rules. The platform does not decide eligibility: it records
PhilHealth's answer.

## What exists

- **Eligibility checks** (`philhealth_eligibility_check`) — per patient and date of service, at a facility: PhilHealth's
  answer as the platform records it (`eligible`, `not_eligible`, `undetermined`; an adapter check may also end
  `failed`), with PhilHealth's reference. Two sources:
  - **PhilHealth's own channel** (`external_channel`) — staff checked outside the platform and record the answer, the
    reference (required) and an optional note. Usable today.
  - **Adapter** (`adapter`) — refused (`integration_not_configured`) while the gateway is a dependency; with an adapter,
    the inquiry is sealed and sent by the integration worker and the answer returns through the outbox.
- **History** — a recorded answer never changes and nothing is deleted (database trigger); only a queued adapter check
  receives its answer.
- **Inquiry** (`platform-eligibility-1`) — patient identity and PhilHealth PIN, the facility's accreditation number, the
  date of service. Not PhilHealth's message format.
- **Readiness checks** — of the platform's data only: PIN recorded, facility accreditation recorded and covering the
  date of service.
- **Gateway port** — `PhilHealthEligibilityGateway.checkEligibility(inquiry, idempotencyKey)` answering
  `answered` (eligible / not_eligible / undetermined, reference, reason codes) / `rejected` / `failed` /
  `not_configured`; the default `UnconfiguredPhilHealthEligibilityGateway` has status `dependency`.
  `PhilHealthEligibilityHandler` runs it in the integration worker and returns the answer as result codes
  (`detail.eligibility`, `detail.reasons`).
- **Claims** — the PhilHealth claim panel shows the latest answered check for the invoice's dates of service. It is
  information for staff, **not** a condition the platform imposes on claims (that would be an invented rule).

## API

| Request                                                      | Notes                                       |
| ------------------------------------------------------------ | ------------------------------------------- |
| `GET /api/v1/philhealth/eligibility?patientId=&serviceDate=` | checks (newest first); readiness for a date |
| `POST /api/v1/philhealth/eligibility/records`                | answer from PhilHealth's channel            |
| `POST /api/v1/philhealth/eligibility/checks` (202)           | through the adapter; idempotency key        |

Permission `philhealth.eligibility.manage` (org_admin, receptionist, cashier); a selected facility is required to
record or ask. Audit: `philhealth.eligibility.list`, `.record`, `.request`, `.answer` (system).

## To implement a real adapter

1. Record the specification in [dependencies.md](dependencies.md).
2. Implement `PhilHealthEligibilityGateway` (map `EligibilityInquiry` to the official format; map the official result to
   the three answers — keep the official codes in `reasons`); provide it to the API (`PhilHealthModule`
   `eligibilityGateway`) and the worker (`IntegrationWorkerModule` `philhealthEligibilityGateway`).
3. If the specification defines membership details worth keeping (e.g. category, dependants), add them as recorded
   fields from the official source — never inferred.
