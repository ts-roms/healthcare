# PhilHealth YAKAP — adapter stubs

| Item                        | Value                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| External system             | PhilHealth YAKAP (primary care) workflows                                                                                          |
| Specification               | **Not obtained.** No registration or encounter format, transport, codes, benefit package, eligibility or deadline rule is modelled |
| Status                      | **Dependency** — recorded references and answers, a format-neutral encounter package, the port and an unconfigured adapter         |
| Accreditation/certification | None claimed. Nothing here makes a facility a YAKAP provider or shows that it meets PhilHealth's requirements                      |
| Code                        | `libs/philhealth/src/lib/yakap*.ts` (`@healthcare/philhealth`), `apps/api/src/app/adapters/philhealth-adapters.ts`                 |
| Migration                   | `0049_philhealth_yakap.sql`                                                                                                        |

Root `CLAUDE.md` §36: never invent government APIs or rules. What exists is the platform's **own** side of a YAKAP
workflow — what staff were told by PhilHealth, and what the platform can assemble from its records — so that a real
adapter can be added once the official specification and access are obtained, without touching clinical code.

## What exists

- **Facility participation** (`philhealth_yakap_participation`) — each facility's YAKAP participation reference as
  issued by PhilHealth (free text, up to 60 characters, since its format is not known), with optional validity dates.
  Recorded by staff, versioned (optimistic locking) and audited with before/after; **not verified** with PhilHealth.
  Same shape and handling as the eClaims accreditation number.
- **Registration answers** (`philhealth_yakap_registration`) — per patient and facility, what PhilHealth's own
  channel answered about the patient's YAKAP registration, in the platform's neutral vocabulary: `registered`,
  `not_registered`, `pending`, `unknown` (no clear answer). Optional effective date as given, PhilHealth's reference
  (required unless `unknown`), a note, who recorded it and when. Append-only: a database trigger refuses updates and
  deletes; a newer answer is a new row. **The platform records the answer; it never decides registration or
  eligibility.**
- **Encounter package** (`platform-yakap-1`, `yakap.ts`) — a format-neutral model of one consultation assembled from
  the platform's records through `PhilHealthYakapSources` (wired in the API; `libs/philhealth` never reads clinic,
  patient, prescription or laboratory tables):
  - patient identity and PhilHealth PIN (identifier `philhealth_pin`);
  - facility id, name and YAKAP participation reference;
  - the latest recorded registration answer for that facility (status, effective date, reference);
  - consultation: local date at the facility, start/end, modality (in person / telemedicine), visit type, clinician
    (name, profession, licence number);
  - ICD-10 coded diagnoses (not entered in error or refuted), primary first;
  - active prescriptions of the consultation (not cancelled or replaced): medicine, strength, form, quantity;
  - laboratory orders of the consultation (not cancelled): order number, tests (code, name, LOINC if recorded).
    Results are not included.

  It is **not** a PhilHealth form or message; an adapter maps it.

- **Readiness checks** — of the platform's own data only: the consultation is signed; the patient's PIN is recorded;
  the facility's participation reference is recorded and covers the consultation date; an ICD-10 coded diagnosis is
  recorded; a registration answer for the facility is recorded (**any** answer — the platform does not judge it).
- **Gateway port** — `PhilHealthYakapGateway.submitEncounter(package, idempotencyKey)` returning the standard
  exchange outcome (`accepted` with reference / `rejected` with reasons / `failed` / `not_configured`) plus
  `specification`. The default `UnconfiguredPhilHealthYakapGateway` has status `dependency` and transmits nothing.
  `PhilHealthYakapHandler` (system `philhealth-yakap`, operation `submit_encounter`) is part of
  `philhealthExchangeHandlers()`, so a real adapter sends through `apps/integration-worker`.
- **Submissions** — `integration_exchange` rows (resource `encounter`): idempotency key, status, digest, reference.
  One queued or accepted submission per consultation. No table of its own.

## Not modelled (the official specification would add them)

- Registration/enrolment and encounter message formats, transport, credentials, code lists and validation rules.
- YAKAP benefit package contents, covered services or medicines, first-patient-encounter (FPE) requirements and forms.
- Capitation amounts, schedules, payment or reconciliation.
- Eligibility, assignment or transfer rules, catchment or member-category conditions.
- Deadlines, filing windows, required attachments or signatures.
- Any PhilHealth status or reason code beyond the reason codes an adapter returns (kept as returned).

Where the specification defines such fields, add them as **recorded** fields from the official source — never inferred.

## API

| Request                                                           | Permission                      | Notes                                                                  |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/philhealth/facilities/{id}/yakap-participation`      | `philhealth.settings.manage`    | `{ participation }`                                                    |
| `PUT /api/v1/philhealth/facilities/{id}/yakap-participation`      | `philhealth.settings.manage`    | `version` required to replace                                          |
| `GET /api/v1/philhealth/yakap/registrations?patientId=`           | `philhealth.eligibility.manage` | answers (newest first), selected facility's reference                  |
| `POST /api/v1/philhealth/yakap/registrations`                     | `philhealth.eligibility.manage` | selected facility; never changed afterwards                            |
| `GET /api/v1/philhealth/yakap/patients/{id}/consultations`        | `philhealth.claim.submit`       | consultations with their latest submission                             |
| `GET /api/v1/philhealth/yakap/encounters/{id}`                    | `philhealth.claim.submit`       | checks, package (PIN masked), registration answer, submissions         |
| `POST /api/v1/philhealth/yakap/encounters/{id}/submissions` (202) | `philhealth.claim.submit`       | `integration_not_configured` (422) while a dependency; idempotency key |

Errors: `integration_not_configured`, `yakap_package_not_ready` (422, failing checks in `details`),
`yakap_already_submitted` (409), `idempotency_key_reused` (409).

**Permissions:** no new ones. The participation reference is a PhilHealth setting like the accreditation number;
registration answers are recorded by the staff who record eligibility answers (org_admin, receptionist, cashier);
the package is prepared and submitted by those who prepare PhilHealth claims (org_admin, cashier). The package carries
clinical data (diagnoses, medicines, tests) — the same kind the eClaims package already shows to that role — and never
notes or results.

**Audit:** `philhealth.yakap.participation.record` (with before/after), `philhealth.yakap.registration.list`,
`philhealth.yakap.registration.record`, `philhealth.yakap.consultation.list`, `philhealth.yakap.package.view`,
`philhealth.yakap.submit-request`, and the worker's `integration.exchange.completed`.

## Screens

- Billing settings: **PhilHealth YAKAP participation** of the selected facility (beside the accreditation).
- Patient record: **PhilHealth YAKAP** card after the eligibility card — "not connected" notice, the latest answer for
  the selected facility (badge: colour + icon + text), history, a form to record PhilHealth's answer, and the
  patient's recent consultations with a **Package** link.
- `/patients/{id}/yakap/{encounterId}`: the prepared package (PIN masked), the checklist, the registration answer and
  earlier submissions; the send button appears only when an adapter is connected. Chosen over the encounter workspace
  so the doctor's screen stays unchanged; the package is an administrative step after signing.
- Administration → Integrations names YAKAP exchanges and links back to the package.

## To implement a real adapter (when the specification is obtained)

1. Record the specification source, version and contact in [dependencies.md](dependencies.md).
2. Implement `PhilHealthYakapGateway` (map `YakapEncounterPackage` to the official format, transport, credentials from
   secrets management), idempotent per key; set `specification.status`.
3. Provide it to the API (`PhilHealthModule.forRoot({ yakapGateway })`, for its specification status) and to
   `apps/integration-worker` (`philhealthExchangeHandlers({ yakapGateway })`).
4. Add the specification's own operations (e.g. registration inquiry) as further ports, following the eligibility
   pattern (sealed inquiry, answer through the outbox); add official fields as recorded data.
5. Validate against PhilHealth's test environment before any production use; do not claim accreditation until granted.
