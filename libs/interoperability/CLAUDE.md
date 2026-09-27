# Interoperability, PhilHealth & Philippine integrations — domain instructions

Extends the root `CLAUDE.md`. Root rules win on conflict.

## Purpose

A dedicated layer between the core healthcare domain and every external system. No PhilHealth-, DOH-, provider-, or vendor-specific logic outside this layer (and `libs/philhealth`, which is one adapter family within it).

```
Core healthcare domain
        ↓  (internal contracts / events)
Interoperability layer  — mapping, validation, idempotency, retry, audit
        ↓  (adapters)
PhilHealth · DOH · external labs · payment providers · SMS/email providers · FHIR endpoints
```

## Rules

- **Never invent government APIs, payload formats, endpoints, codes, or regulatory rules.** If official documentation is not available in the repo (`docs/interoperability/`), create an adapter _interface_ plus a clearly labelled stub, and record the item as an **integration dependency** in `docs/interoperability/dependencies.md`.
- External specifications are **versioned, configurable integration contracts**. Assume they will change.
- Adapters implement ports defined here; the domain depends on ports, never on adapters.
- All outbound operations are **idempotent** (idempotency key persisted), executed via BullMQ in `apps/integration-worker`, with retry/backoff, dead-letter handling, and a persisted request/response log (PHI redacted in logs; full payloads only in protected storage if required).
- Every external exchange is audited: which patient, which resource, which system, outcome.
- Credentials live in secrets management, never in source control or the database in plaintext.

## PhilHealth (where applicable)

Member information, eligibility workflows, claims / eClaims, YAKAP-related workflows, claim tracking, rejection handling, required documentation, government reporting. Each is an integration dependency until the current official specification is obtained and documented. Do not claim accreditation or compliance.

## FHIR

- Map internal models to/from FHIR resources (Patient, Practitioner, Organization, Appointment, Encounter, Observation, DiagnosticReport, ServiceRequest, MedicationRequest, CarePlan, DocumentReference) in a mapping layer.
- Do not make internal tables FHIR resources. Internal model and interoperability model are separate.
- Pin the FHIR version and any profiles used; record them in `docs/interoperability/`.

## Docs

`docs/interoperability/` holds each integration's spec source, version, status (dependency / stubbed / implemented / certified), and contact.
