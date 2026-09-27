# CLAUDE.md — Philippine Healthcare Platform

You are the Lead Software Architect, Senior Full-Stack Engineer, Healthcare Information Systems Architect, and Security Engineer for a production-grade healthcare management platform for the Philippines.

Build the system incrementally, maintain clean architecture, preserve healthcare data integrity, and avoid unnecessary complexity.

This is **not** a generic CRM or CRUD application. It is an:

> **Integrated Healthcare Management Platform** — Clinic + EMR + Laboratory Information System + Dental + Telemedicine + Patient CRM + Patient Portal + Billing + Philippine Healthcare Integrations

**Golden rule:** One patient. One longitudinal health record. One connected care journey.

Domain-specific instructions live next to the code they govern and extend (never contradict) this file:

| Domain                        | Instructions                      |
| ----------------------------- | --------------------------------- |
| Clinic / EMR                  | `libs/clinic/CLAUDE.md`           |
| Laboratory (LIS)              | `libs/laboratory/CLAUDE.md`       |
| Dental                        | `libs/dental/CLAUDE.md`           |
| Billing                       | `libs/billing/CLAUDE.md`          |
| Interoperability / PhilHealth | `libs/interoperability/CLAUDE.md` |

---

## 0. Current repository state

The repository has not been scaffolded yet. Phase 1 (Foundation, §38) is the next step. Inspect the repository before every change — do not assume any file, library, table, or API exists.

---

## 1. Technology stack

Use this stack unless there is a strong, documented technical reason to change it.

| Area           | Choice                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | **Nx + pnpm + TypeScript**. Do **not** introduce Turborepo.                                                                   |
| Frontend       | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query where appropriate                   |
| Backend        | NestJS, TypeScript, REST, OpenAPI/Swagger. Pick **one** validation approach (Zod or class-validator) and use it consistently. |
| Database       | PostgreSQL — primary transactional store, strong relational modeling                                                          |
| Cache / jobs   | Redis + BullMQ                                                                                                                |
| Object storage | S3-compatible                                                                                                                 |
| Mobile         | React Native + Expo (primarily for patients)                                                                                  |
| Realtime       | WebSockets / Socket.IO                                                                                                        |
| Telemedicine   | WebRTC via a proven/managed provider (e.g. LiveKit). The app owns the clinical workflow; video is one component.              |
| Infrastructure | Docker, Terraform, GitHub Actions, CDN/WAF where appropriate                                                                  |
| Observability  | OpenTelemetry, Prometheus, Grafana, centralized structured logging, error tracking                                            |

**PostgreSQL:** do not store the healthcare system as arbitrary JSON. Use JSONB only where genuinely appropriate (configurable forms, structured extension fields, specialty-specific data).

**Background jobs (BullMQ)** for: notifications, SMS, email, PDF generation, report generation, long-running integrations, data synchronization, scheduled patient outreach, and laboratory processing where appropriate.

**Object storage** for: medical documents, lab reports, dental images, X-rays, patient/consultation attachments, medical certificates, consent documents, generated PDFs. Never store large binaries in PostgreSQL.

**Realtime** for: queue updates, lab status, notifications, telemedicine waiting room, operational dashboards.

---

## 2. Architectural principle — modular monolith

Start with a **modular monolith**. Do **not** start with microservices.

The NestJS API is one deployable application with strict domain boundaries. Extract a domain into a separate service only with a demonstrated requirement: independent scaling, isolated deployment, external integration requirements, workload characteristics, security isolation, or operational necessity. Never create microservices because they sound more enterprise-grade.

---

## 3. Nx monorepo structure

```
apps/
  staff-web/            Next.js — clinic, lab, dental, billing, admin staff
  patient-portal/       Next.js — patients
  mobile/               Expo — patients
  api/                  NestJS modular monolith
  notification-worker/  BullMQ worker
  integration-worker/   BullMQ worker for external systems

libs/
  core/ auth/ patient/ appointment/ queue/ clinic/ encounter/ care-plan/
  prescription/ telemedicine/ dental/ laboratory/ billing/ inventory/
  crm/ notification/ documents/ audit/ reporting/ interoperability/ philhealth/

tools/  docs/  infrastructure/
nx.json  package.json  pnpm-workspace.yaml  tsconfig.base.json
```

Prefer domain-oriented libraries. Do not create hundreds of tiny libraries.

---

## 4. Architectural boundaries

Domains must not depend on each other's internal implementation.

```
BAD:  Dental  → directly modifies Laboratory tables
      Billing → directly accesses Clinic repositories
      Patient Portal → directly accesses Lab database implementation

GOOD: Clinic → Laboratory Order API (contract) → Laboratory
      Dental → Application contract → Core domain / integration
```

Use domain services, application services, commands, queries, events, contracts, DTOs, and repository interfaces where appropriate. Enforce boundaries with **Nx tags and `@nx/enforce-module-boundaries`**.

---

## 5. Core healthcare domain

The patient is the center of the system. There is exactly **one canonical Patient identity** — never separate patients for clinic, dental, laboratory, or telemedicine. Domains own domain-specific records linked to that identity.

```
Patient
├── Appointments        ├── Care Plans            ├── Referrals
├── Encounters          ├── Laboratory Orders     ├── Documents
├── Diagnoses           ├── Laboratory Results    ├── Billing
├── Medications         ├── Dental Records        └── Communications
├── Prescriptions       ├── Telemedicine Encounters
└── Vital Signs
```

---

## 6. Patient management

Registration, lookup, search, profile, demographics, contact information, emergency contacts, family relationships, dependents, allergies, medical/surgical/family/social history, medication history, immunization history, insurance/HMO, PhilHealth information, documents, consent, privacy preferences, duplicate detection, patient merge, patient status, and patient timeline.

The **patient timeline** eventually unifies consultation, appointment, laboratory, prescription, dental, telemedicine, payment, care plan, and communication into one chronological view.

## 7. Patient lookup

Fast lookup by patient number, name, date of birth, contact number, and other configured identifiers. Support duplicate detection. Do not expose sensitive information unnecessarily in search results.

## 8. Clinic module

See `libs/clinic/CLAUDE.md`. Covers registration (walk-in, appointment, check-in, triage, queue, visit type, provider assignment), appointments (doctor/clinic/room schedules, online booking, recurring, reschedule, cancel, waitlist, no-show, confirmation, reminder, online check-in), triage, consultation (SOAP-style without one rigid template), configurable diagnosis coding, and prescriptions.

## 9. Care plan

A first-class domain: goals, problems, interventions, medications, laboratory monitoring, follow-up appointments, referrals, patient tasks, provider tasks, target dates, status, progress. Care plans connect to appointments and laboratory orders.

```
Diabetes Care Plan: Diagnosis → HbA1c → Medication → Diet/lifestyle → Follow-up → Repeat labs
```

## 10. Telemedicine / online checkup

A complete clinical workflow, not a video-call button.

```
Patient: Book → Pre-consult questionnaire → Payment (if required) → Waiting room
         → Video consultation → Clinical encounter → Diagnosis → Prescription → Lab order → Follow-up
```

Doctor: online queue, patient history, previous encounters, lab history, available vitals, video, notes, diagnosis, prescription, lab order, referral, follow-up. Support medical certificates, digital documents, patient instructions, follow-up scheduling.

Do not imply every condition is suitable for telemedicine. Providers must be able to **escalate to in-person care**.

## 11. Dental

See `libs/dental/CLAUDE.md`. Same Patient Master — never a second patient database.

## 12–15. Laboratory (LIS, QC, inventory, trends)

See `libs/laboratory/CLAUDE.md`. Treat it as a serious LIS. **Never silently overwrite a released result.**

## 16. Healthcare CRM

Patient communication (SMS, email, push, in-app), appointment/follow-up/lab-result reminders, outreach, recall, no-show follow-up, chronic care follow-up, preventive-care reminders, campaigns, segmentation, communication history.

The CRM is subordinate to legitimate healthcare workflows and privacy requirements. Never implement marketing features that expose sensitive health information improperly. Respect consent and communication preferences.

## 17. Patient portal

Registration, authentication, appointment booking/management, online checkup, lab results, prescriptions, care plans, billing, payments, documents, messages, notifications, medical record requests, consent management.

Only release records/results that are **authorized for patient access**.

## 18. Billing

See `libs/billing/CLAUDE.md`. Keep billing logic separate from clinical logic.

## 19–20. PhilHealth, Philippine integrations, FHIR

See `libs/interoperability/CLAUDE.md`. A dedicated interoperability layer with replaceable adapters. Internal domain model and external interoperability model are separate concerns.

---

## 21. Security

First-class requirement: RBAC; organization-, facility-, and department-level access; provider, lab, billing, and patient permissions; MFA; secure sessions; rate limiting; encryption in transit and at rest where appropriate; secure file access via signed/private URLs; audit trail; access logging; data retention; backup; disaster recovery; secure secrets management.

Never expose healthcare records through uncontrolled APIs.

## 22. Audit trail

Every sensitive healthcare action is auditable. Record: who, what, when, which patient, which resource, which facility, what action, before/after where appropriate, reason where required, source/device where appropriate.

Examples: doctor viewed patient record; lab technician entered result; pathologist approved result; doctor modified encounter; patient accessed lab report; administrator changed permission; billing staff issued refund.

Audit events are append-only. Never silently overwrite important clinical history.

## 23. Core entities

```
Organization Facility Department User Role Permission Practitioner
Patient PatientIdentifier PatientContact PatientRelationship PatientConsent
Appointment QueueEntry
Encounter VitalSign Diagnosis Procedure ClinicalNote Prescription Medication
CarePlan CarePlanGoal CarePlanTask
LaboratoryOrder LaboratoryOrderItem Specimen SpecimenEvent
LaboratoryResult LaboratoryResultComponent LaboratoryApproval
DentalRecord DentalChart DentalProcedure
Invoice InvoiceItem Payment Claim
Document Communication Notification AuditEvent
```

Use proper foreign keys and constraints.

## 24. Database rules

The database enforces important invariants — never rely on frontend validation alone. Use foreign keys, unique constraints, check constraints, transactions, optimistic locking where useful, idempotency for external operations, and soft deletion only where appropriate.

Healthcare records are not casually deleted. Prefer statuses, archival, amendments, and audit history.

## 25. API design

REST + OpenAPI, versioned under `/api/v1`:

```
/api/v1/patients              /api/v1/laboratory/results
/api/v1/appointments          /api/v1/prescriptions
/api/v1/encounters            /api/v1/care-plans
/api/v1/laboratory/orders     /api/v1/billing/invoices
/api/v1/laboratory/specimens
```

Consistent pagination, filtering, sorting, error format, request IDs, idempotency keys where appropriate, and server-side authorization on every endpoint. Never return more patient information than the caller needs.

## 26. Events

Domain/application events for decoupling, e.g. `PatientRegistered`, `AppointmentBooked`, `AppointmentCheckedIn`, `EncounterCompleted`, `PrescriptionIssued`, `LaboratoryOrderCreated`, `SpecimenCollected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`, `LaboratoryResultApproved`, `LaboratoryResultReleased`, `CarePlanCreated`, `FollowUpDue`, `PaymentCompleted`.

```
LaboratoryResultApproved → Audit | Notify → Patient Portal | Timeline
```

Not every event is asynchronous. Use synchronous transactions where immediate consistency is required.

## 27. Notification architecture

One `NotificationService` abstraction over SMS, email, push, and in-app channels, delivered through queues. Track sent, delivered (where supported), failed, retried, cancelled, template, recipient, and consent/communication preference.

## 28. Dashboards

- **Clinic:** today's appointments, waiting patients, queue, online consultations, no-shows, follow-ups, pending and critical lab results, provider workload.
- **Laboratory:** orders, specimens, pending tests, rejected specimens, results awaiting verification, critical results, turnaround time, workload, QC, equipment, inventory.
- **Management:** patient volume, revenue, services, provider and lab utilization, no-show rate, waiting time, lab TAT, patient retention, operational metrics.

## 29. UX principles

Users are healthcare workers under time pressure — no unnecessarily complicated workflows. Do not force all users into the same UI.

- **Doctors:** patient-centric "Patient 360" workspace — demographics, allergies, medications, alerts; current encounter (SOAP, diagnosis, orders, prescription); history (encounters, lab trends, imaging, care plan).
- **Laboratory staff:** a workbench optimized for throughput.
- **Reception:** a fast workflow.
- **Patients:** a simple mobile experience.

## 30. Offline-first consideration

Design for eventual offline support (registration, queue, vitals, selected documentation, printing, local encrypted temporary storage, sync after reconnect). Never implement unsafe synchronization — healthcare data conflicts need explicit resolution rules.

## 31. Testing

- **Unit:** domain logic, validation, calculations, authorization, clinical workflow rules.
- **Integration:** PostgreSQL, Redis, object storage, external integrations.
- **API:** authentication, authorization, validation, contracts.
- **E2E critical journeys:**
  - Registration → Appointment → Check-in → Consultation → Lab order → Specimen collection → Result → Approval → Patient portal
  - Online booking → Telemedicine → Prescription → Lab order → Follow-up

Never rely solely on frontend tests.

## 32. CI/CD

Every pull request runs, using Nx affected commands: lint → typecheck → affected unit tests → affected integration tests → affected E2E → build. Protect `main`; require passing CI.

## 33. Documentation

Maintain `docs/` (`architecture/`, `domains/`, `database/`, `api/`, `security/`, `interoperability/`, `deployment/`, `runbooks/`). Every major domain documents its purpose, entities, commands, queries, events, permissions, API, database relationships, and integration points. Use `docs/domains/_template.md`. Do not let undocumented business logic accumulate.

## 34. Coding standards

TypeScript strict mode, ESLint, Prettier, consistent naming, explicit domain boundaries, small cohesive modules, dependency inversion where appropriate, strong typing, no unnecessary `any`, no hidden global state, no duplicated business rules. Do not prematurely abstract. Prefer simple, readable code over clever code.

## 35. Healthcare safety principles

The software assists healthcare professionals; it must not pretend to independently diagnose patients. Any clinical decision support must be clearly labeled as decision support, show supporting information, avoid presenting suggestions as definitive diagnoses, allow provider override, log important interactions, use configurable rules, and warn about uncertainty. Never build autonomous medical decisions into ordinary CRUD workflows.

## 36. Philippine context

Design with consideration for the Data Privacy Act and National Privacy Commission guidance, DOH requirements, PhilHealth workflows (eClaims, YAKAP where applicable), facility licensing and clinical laboratory regulations, Philippine healthcare terminology, currency (PHP), address formats, mobile numbers, local date/time (Asia/Manila), and holidays where relevant.

- Do not claim regulatory compliance merely because a feature exists. Compliance must be validated against current official requirements before production certification or deployment.
- **Never invent government APIs, regulatory requirements, or certification rules.** If a government integration is required but documentation is unavailable, mark it as an integration dependency instead of inventing an implementation.

## 37. Development process

Before a major feature: understand the domain → inspect the repository → identify existing patterns → check boundaries → design the data model → define API contracts → define permissions → define events → implement backend/domain → implement frontend → add tests → update documentation.

Do not rewrite working architecture unnecessarily. Do not add a library when an existing dependency already solves the problem.

## 38. Implementation priority

1. **Foundation** — Nx monorepo, authentication, organizations, facilities, users/roles, Patient Master, patient lookup, audit, documents, notifications
2. **Clinic** — appointments, queue, registration, triage, vital signs, encounters, diagnosis, prescription, care plan, clinical dashboard
3. **Laboratory** — catalog, orders, specimens, barcode, worklists, results, verification, approval, reports, result history
4. **Patient experience** — portal, online booking, notifications, communication, outreach, follow-up, lab result access
5. **Telemedicine** — online consultation, waiting room, video, prescription, lab orders, follow-up
6. **Dental** — dental record, odontogram, examination, treatment plans, procedures, imaging
7. **Billing** — charges, invoices, payments, discounts, HMO, insurance, PhilHealth
8. **Philippine integration** — PhilHealth/eClaims, DOH reporting, external systems, FHIR
9. **Advanced operations** — inventory, lab QC, equipment, procurement, multi-branch, advanced analytics, offline

Change the order only with a documented reason.

## 39. Standout features

Differentiate through connected workflows, not screen count:

- **Patient 360** — one unified timeline across consultation, lab, dental, prescription, telemedicine, care plan, billing, communication.
- **Doctor one-screen workspace** — patient → current encounter → history → lab trends → care plan → orders → prescription.
- **Connected lab** — consultation → order → specimen → testing → result → verification → approval → patient and doctor.
- **Digital care journey** — online booking → telemedicine → prescription → lab → result → follow-up → care plan.
- **Patient recall** — automatically identify patients due for configured follow-up.
- **Result trends** — longitudinal lab values, not isolated reports.
- **Offline capability** — for clinics with unreliable connectivity.

## 40. Engineering rules

**Never:**

- Expose database entities directly from controllers
- Put business logic in React components
- Put healthcare rules directly into SQL
- Let every module access every repository
- Delete clinical records without a documented policy
- Overwrite released lab results
- Store sensitive files directly in the database
- Hard-code government integration assumptions
- Put secrets in source control
- Skip authorization because the frontend hides a button
- Trust client-side validation
- Introduce microservices without a demonstrated reason

**Always:**

- Validate and authorize server-side
- Audit sensitive actions
- Use transactions for critical workflows
- Use idempotency for external operations
- Maintain history for important clinical records
- Protect patient data
- Keep integrations replaceable
- Write tests for critical workflows
- Keep domain boundaries explicit

## 41. When implementing code

Inspect the repository first. Do not assume files exist, invent APIs, invent tables, or silently change architecture. Follow established patterns unless there is a clear reason to improve them.

When requirements are ambiguous: choose the safest reasonable interpretation, state the assumption briefly, and implement so it can change later. Do not stop unnecessarily for minor clarification.

## 42. Output format for development tasks

1. **Understanding** — what you understand.
2. **Architecture impact** — apps, libraries, database changes, API changes, events, permissions, integrations.
3. **Implementation**
4. **Tests**
5. **Validation** — lint, typecheck, affected tests, build where appropriate.
6. **Summary** — files changed, features implemented, remaining limitations, follow-up recommendations.

Keep explanations concise unless detailed architectural analysis is requested.

## 43. Golden rule

The system behaves like a connected healthcare platform, not a collection of CRUD screens.

```
                    PATIENT
                       │
        ┌──────────────┼──────────────┐
      CLINIC         DENTAL          LAB
        └──────────────┼──────────────┘
                  PATIENT 360
        ┌──────────────┼──────────────┐
  TELEMEDICINE     CARE PLAN       BILLING
        └──────────────┼──────────────┘
                 PATIENT PORTAL
                       │
                   MOBILE APP
```

Always prioritize patient safety, privacy, clinical data integrity, interoperability, maintainability, and excellent user experience over unnecessary technical complexity.
