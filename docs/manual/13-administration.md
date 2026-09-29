# 13. Administration

**What this is for.** This chapter is for the people who set up and look after the platform for an organization: which roles exist and what each may do by
default, how staff accounts, roles, facilities and departments are managed, where each configurable setting lives, how the audit trail works, and the data
privacy points administrators should know.

**Who uses it.** Organization administrators, IT staff who support them, records officers and auditors. Other staff can read the roles section to understand
why a button or menu is missing.

> Several administration tasks have **no screen in the staff app yet**: managing staff users, roles, facilities and departments, clinic set-up
> (practitioners, schedules, rooms), and reading the audit trail. They are done through the platform's REST API (`/api/v1`, documented at `/api/docs` on the
> API server) by someone with the right permission, usually IT on behalf of the administrator. This chapter names those API calls briefly.

## Roles and default permissions

Access is granted by **roles**. A role is a named set of **permissions**. A person can hold several roles; their permissions add up.

A role can be granted:

- **organization-wide** — it applies at every facility; or
- **for one facility** — it applies only while that facility is selected in the top bar; or
- **for one department** of a facility.

The platform ships these system roles. Organizations can also create their own roles (see below).

| Role                       | Intended for                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Organization administrator | Full administrative access within the organization. Holds every permission.                             |
| Physician                  | Clinical access to patient records: document, sign, amend, prescribe, order laboratory tests.           |
| Dentist                    | A physician's clinical access plus dental examinations, charting, treatment plans, procedures, imaging. |
| Nurse                      | Clinical support: triage and vitals, allergies, care plans, specimen collection, dispensing, stock.     |
| Dental assistant           | Dental chairside support: dental record and imaging; clinical support like a nurse.                     |
| Receptionist               | Front desk: registration and lookup, appointments, queue, portal invitations, PhilHealth answers.       |
| Medical records officer    | Maintains patient records and documents; reviews imported records; DOH case reports.                    |
| Medical technologist       | Laboratory specimen handling, result entry and verification, QC entry.                                  |
| Pathologist                | Laboratory result approval, release and correction; catalog and quality management.                     |
| Phlebotomist               | Specimen collection.                                                                                    |
| Pharmacist                 | Dispensing from prescriptions; pharmacy stock.                                                          |
| Cashier                    | Billing: charges, invoices, discounts, payments, deposits, PhilHealth claim preparation.                |
| Inventory officer          | Stock receiving, issuing, counts and write-offs; inventory catalog; purchase orders.                    |
| Auditor                    | Read-only access to the audit trail.                                                                    |

Holding a permission is not always enough. Starting or signing an encounter, prescribing and recording dental work also need the user's account to be linked to
an active **practitioner** of an allowed profession (for example, dental recording needs profession `dentist`). Only the responsible practitioner may sign an
encounter.

The tables below list every permission in the platform and which system roles hold it by default. The **Organization administrator** holds all of them and is
not repeated. A dash (—) means only the organization administrator has it by default.

### Organization, users and audit

| Permission            | What it allows                                           | Default roles (besides Organization administrator)                                                                                                                          |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.read`          | View the audit trail                                     | Auditor                                                                                                                                                                     |
| `organization.manage` | Manage organization settings, facilities and departments | —                                                                                                                                                                           |
| `organization.read`   | View organization, facilities and departments            | Auditor, Dental assistant, Dentist, Inventory officer, Medical records officer, Medical technologist, Nurse, Pathologist, Pharmacist, Phlebotomist, Physician, Receptionist |
| `role.manage`         | Create and edit organization roles                       | —                                                                                                                                                                           |
| `user.manage`         | Create staff users, grant and revoke roles               | —                                                                                                                                                                           |
| `user.read`           | View staff users and their role assignments              | —                                                                                                                                                                           |

### Patients and documents

| Permission               | What it allows                                                    | Default roles (besides Organization administrator)                                                                                                       |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.archive`       | Archive documents                                                 | Medical records officer                                                                                                                                  |
| `document.read`          | Download documents                                                | Dental assistant, Dentist, Medical records officer, Nurse, Physician                                                                                     |
| `document.upload`        | Upload documents                                                  | Dental assistant, Dentist, Medical records officer, Nurse, Physician, Receptionist                                                                       |
| `notification.read`      | View notification history                                         | Dentist, Physician                                                                                                                                       |
| `notification.send`      | Send notifications to patients and staff                          | Receptionist                                                                                                                                             |
| `patient.consent.manage` | Record patient consent and communication preferences              | Dental assistant, Dentist, Medical records officer, Nurse, Physician, Receptionist                                                                       |
| `patient.portal.manage`  | Invite patients to the patient portal and disable portal accounts | Medical records officer, Receptionist                                                                                                                    |
| `patient.read`           | View a patient's registration record                              | Cashier, Dental assistant, Dentist, Medical records officer, Medical technologist, Nurse, Pathologist, Pharmacist, Phlebotomist, Physician, Receptionist |
| `patient.register`       | Register new patients                                             | Dental assistant, Dentist, Nurse, Physician, Receptionist                                                                                                |
| `patient.search`         | Search the patient index (minimal result fields)                  | Cashier, Dental assistant, Dentist, Medical records officer, Medical technologist, Nurse, Pathologist, Pharmacist, Phlebotomist, Physician, Receptionist |
| `patient.update`         | Update patient demographics, contacts and identifiers             | Dental assistant, Dentist, Medical records officer, Nurse, Physician, Receptionist                                                                       |

### Clinic (appointments, queue, triage, encounters)

| Permission              | What it allows                                                                   | Default roles (besides Organization administrator)                                 |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `allergy.manage`        | Record and update allergies and allergy reviews                                  | Dental assistant, Dentist, Nurse, Physician                                        |
| `appointment.manage`    | Book, confirm, reschedule, cancel appointments and manage the waitlist           | Dentist, Physician, Receptionist                                                   |
| `appointment.read`      | View appointments, schedules and availability                                    | Dental assistant, Dentist, Medical records officer, Nurse, Physician, Receptionist |
| `clinic.configure`      | Manage practitioners, schedules, rooms, visit types, coding systems and closures | —                                                                                  |
| `clinic.dashboard.read` | View the clinic dashboard                                                        | Dental assistant, Dentist, Nurse, Physician, Receptionist                          |
| `clinic.queue.manage`   | Check patients in and move them through the queue                                | Dental assistant, Dentist, Nurse, Physician, Receptionist                          |
| `clinic.queue.read`     | View the facility queue                                                          | Dental assistant, Dentist, Nurse, Physician, Receptionist                          |
| `clinic.triage.write`   | Record triage assessments and vital signs                                        | Dental assistant, Dentist, Nurse, Physician                                        |
| `clinical.read`         | View clinical summaries: allergies, vital signs, problem list                    | Dental assistant, Dentist, Medical records officer, Nurse, Physician               |
| `encounter.amend`       | Amend signed encounters                                                          | Dentist, Physician                                                                 |
| `encounter.read`        | View encounters, notes and diagnoses                                             | Dental assistant, Dentist, Medical records officer, Nurse, Physician               |
| `encounter.sign`        | Sign (complete) encounters                                                       | Dentist, Physician                                                                 |
| `encounter.write`       | Start encounters, write notes, record diagnoses                                  | Dentist, Physician                                                                 |

### Prescriptions and care plans

| Permission              | What it allows                                                      | Default roles (besides Organization administrator)                               |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `care-plan.manage`      | Create and update care plans, goals and activities                  | Dental assistant, Dentist, Nurse, Physician                                      |
| `care-plan.read`        | View care plans and due follow-ups                                  | Dental assistant, Dentist, Medical records officer, Nurse, Physician             |
| `prescription.cancel`   | Cancel prescriptions                                                | Dentist, Physician                                                               |
| `prescription.dispense` | Dispense prescribed items from stock and reverse mistaken dispenses | Nurse, Pharmacist                                                                |
| `prescription.issue`    | Issue and replace prescriptions                                     | Dentist, Physician                                                               |
| `prescription.read`     | View prescriptions                                                  | Dental assistant, Dentist, Medical records officer, Nurse, Pharmacist, Physician |

### Telemedicine

| Permission             | What it allows                                                    | Default roles (besides Organization administrator)        |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `telemedicine.conduct` | Start, join, end and escalate online consultations                | Dentist, Physician                                        |
| `telemedicine.read`    | View the online consultation queue and pre-consult questionnaires | Dental assistant, Dentist, Nurse, Physician, Receptionist |

### Laboratory

| Permission             | What it allows                                                                         | Default roles (besides Organization administrator)                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `lab.catalog.manage`   | Manage the laboratory catalog, reference ranges, panels and facility laboratory policy | Pathologist                                                                                                           |
| `lab.critical.manage`  | Document the communication of critical laboratory results                              | Medical technologist, Pathologist                                                                                     |
| `lab.dashboard.read`   | View the laboratory dashboard                                                          | Medical technologist, Pathologist                                                                                     |
| `lab.order.cancel`     | Cancel laboratory orders and order items                                               | Dentist, Physician                                                                                                    |
| `lab.order.create`     | Order laboratory tests                                                                 | Dentist, Medical technologist, Physician                                                                              |
| `lab.order.read`       | View laboratory orders, specimens and worklists                                        | Dental assistant, Dentist, Medical records officer, Medical technologist, Nurse, Pathologist, Phlebotomist, Physician |
| `lab.result.amend`     | Correct released laboratory results (creates a new version)                            | Pathologist                                                                                                           |
| `lab.result.approve`   | Approve (authorize) laboratory results                                                 | Pathologist                                                                                                           |
| `lab.result.enter`     | Enter laboratory results                                                               | Medical technologist                                                                                                  |
| `lab.result.read`      | View laboratory results                                                                | Dental assistant, Dentist, Medical records officer, Medical technologist, Nurse, Pathologist, Physician               |
| `lab.result.release`   | Release approved laboratory results                                                    | Pathologist                                                                                                           |
| `lab.result.verify`    | Verify laboratory results                                                              | Medical technologist, Pathologist                                                                                     |
| `lab.specimen.collect` | Collect specimens (assigns accession numbers)                                          | Dental assistant, Medical technologist, Nurse, Phlebotomist                                                           |
| `lab.specimen.receive` | Receive specimens in the laboratory                                                    | Medical technologist                                                                                                  |
| `lab.specimen.reject`  | Reject specimens and request recollection                                              | Medical technologist                                                                                                  |

### Laboratory quality

| Permission      | What it allows                                                               | Default roles (besides Organization administrator) |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `lab.qc.enter`  | Enter QC runs, corrective actions and instrument maintenance and calibration | Medical technologist, Pathologist                  |
| `lab.qc.manage` | Manage QC materials, lots and targets, and instruments                       | Pathologist                                        |
| `lab.qc.read`   | View laboratory quality control, instruments and their logs                  | Medical technologist, Pathologist                  |

### Dental

| Permission                     | What it allows                                                                       | Default roles (besides Organization administrator) |
| ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `dental.chart.write`           | Record dental examinations and chart teeth                                           | Dentist                                            |
| `dental.imaging.read`          | Open dental radiographs and photos                                                   | Dental assistant, Dentist                          |
| `dental.imaging.release`       | Share dental images with the patient in MyHealth, and withdraw them                  | Dentist                                            |
| `dental.imaging.upload`        | Add dental radiographs and photos                                                    | Dental assistant, Dentist                          |
| `dental.procedure.record`      | Record performed dental procedures                                                   | Dentist                                            |
| `dental.record.read`           | View the dental record: chart, examinations, treatment plans, procedures, image list | Dental assistant, Dentist, Nurse, Physician        |
| `dental.record.write`          | Correct the dental record: mark examinations, procedures and images entered in error | Dentist                                            |
| `dental.settings.manage`       | Manage the dental procedure catalog and tooth notation                               | —                                                  |
| `dental.treatment-plan.manage` | Propose dental treatment plans and record the patient's decision                     | Dentist                                            |

### Billing

| Permission                  | What it allows                                                          | Default roles (besides Organization administrator) |
| --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `billing.charge.capture`    | Add manual charges and cancel uninvoiced charges                        | Cashier                                            |
| `billing.charge.read`       | View charges, invoices and payments                                     | Cashier, Receptionist                              |
| `billing.credit-note.issue` | Issue credit notes against issued invoices (with a reason)              | —                                                  |
| `billing.debit-note.issue`  | Issue debit notes against issued invoices (with a reason)               | —                                                  |
| `billing.deposit.record`    | Record patient deposits and apply deposit or credit balance to invoices | Cashier                                            |
| `billing.discount.apply`    | Apply discounts, including statutory discounts with evidence            | Cashier                                            |
| `billing.invoice.issue`     | Prepare and issue invoices, set payer coverage                          | Cashier                                            |
| `billing.invoice.void`      | Void issued invoices (with a reason)                                    | —                                                  |
| `billing.payment.record`    | Record patient payments                                                 | Cashier                                            |
| `billing.pricelist.manage`  | Manage billable services, prices, payers and discount rules             | —                                                  |
| `billing.refund.issue`      | Refund payments (with a reason)                                         | —                                                  |
| `billing.report.read`       | View billing reports (collections, receivables)                         | Cashier                                            |

### PhilHealth

| Permission                      | What it allows                                                                     | Default roles (besides Organization administrator) |
| ------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `philhealth.claim.submit`       | Prepare PhilHealth claims from issued invoices and request their submission        | Cashier                                            |
| `philhealth.eligibility.manage` | View and record PhilHealth eligibility checks, and request them through an adapter | Cashier, Receptionist                              |
| `philhealth.settings.manage`    | Record facility PhilHealth accreditation numbers                                   | —                                                  |

### Inventory

| Permission                      | What it allows                                                                   | Default roles (besides Organization administrator)                           |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `inventory.adjust`              | Adjust counts and write off stock (with a reason)                                | Inventory officer                                                            |
| `inventory.catalog.manage`      | Manage items, suppliers, storage locations and reorder levels                    | Inventory officer                                                            |
| `inventory.move`                | Receive, issue and transfer stock                                                | Dental assistant, Inventory officer, Medical technologist, Nurse, Pharmacist |
| `inventory.procurement.approve` | Approve submitted purchase orders (never one you submitted)                      | —                                                                            |
| `inventory.procurement.manage`  | Draft, submit, cancel and close purchase orders; receive deliveries against them | Inventory officer                                                            |
| `inventory.read`                | View stock, lots, movements, low-stock and expiry lists                          | Dental assistant, Inventory officer, Medical technologist, Nurse, Pharmacist |

### Records, reporting and integrations

| Permission                    | What it allows                                                                                     | Default roles (besides Organization administrator) |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `doh.report.manage`           | Review disease case reports: confirm, record as reported, dismiss, submit                          | Dentist, Medical records officer, Physician        |
| `doh.settings.manage`         | Configure reportable conditions and the facility's DOH health facility code                        | —                                                  |
| `integration.exchange.manage` | Review outbound integration exchanges: see failures, re-queue stalled ones, record a resolution    | —                                                  |
| `interop.fhir.import`         | Submit FHIR R4 content for import (received into the review queue, never into the record; audited) | —                                                  |
| `interop.fhir.import.review`  | Review FHIR imports: view received content, match the patient, accept or reject entries (audited)  | Medical records officer                            |
| `interop.fhir.read`           | Read patient records through the FHIR R4 interface (whole-record export; audited)                  | —                                                  |

**Things to notice in the defaults:**

- Several powerful actions are held only by the organization administrator: voiding invoices, refunds, credit and debit notes, price lists, DOH settings,
  PhilHealth settings, dental settings, clinic configuration, approving purchase orders, integration review, FHIR read and import, and all user, role and
  organization management. Grant them to a custom role if someone else must do them.
- The facility selector lists the facilities where a person holds a role (every facility for an organization-wide role). It does not need
  `organization.read`, so a cashier-only user can choose their facility.
- The **Auditor** role has no screen to use yet: the audit trail is read through the API (see below).

## How staff accounts are managed

There is no user-management screen yet. The **Administration** menu currently contains only **Integrations**. Use these API calls (each is audited):

| Task                                  | API call                                                                                      | Permission    | Notes                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| List staff and their role assignments | `GET /api/v1/users`, `GET /api/v1/users/{userId}`                                             | `user.read`   |                                                                                                                                         |
| Add a person to the organization      | `POST /api/v1/users` (email, display name, initial password)                                  | `user.manage` | Creates the account if the email is new (initial password of 12+ characters required); otherwise adds the existing account as a member. |
| Suspend or reactivate a member        | `PATCH /api/v1/users/{userId}/membership` (status, reason)                                    | `user.manage` | Suspension ends their access immediately. You cannot change your own membership.                                                        |
| Grant a role                          | `POST /api/v1/users/{userId}/role-assignments` (role, optional facility, optional department) | `user.manage` | A department grant also needs its facility.                                                                                             |
| Revoke a role                         | `DELETE /api/v1/users/{userId}/role-assignments/{assignmentId}` (optional reason)             | `user.manage` | Revoked assignments are kept in history.                                                                                                |
| List roles and their permissions      | `GET /api/v1/roles`, `GET /api/v1/permissions`                                                | `user.read`   |                                                                                                                                         |
| Create a custom role                  | `POST /api/v1/roles` (key, name, description, permissions)                                    | `role.manage` | Existing roles cannot be edited or deleted through the API yet; create a new role and re-grant instead.                                 |

**Rules for granting access:**

- Nobody can grant a role, or create a role, containing permissions they do not hold themselves ("You cannot grant permissions you do not hold").
- A user's permissions are recalculated on every request, so a grant or revocation takes effect at their next action. The sidebar updates on the next page
  load.
- To link a staff account to a practitioner (needed to sign encounters, prescribe and record dental work), use the clinic set-up calls below.

**Passwords and two-step verification.** Each user changes their own password and turns two-step verification (TOTP) on or off through the API
(`POST /api/v1/auth/password`, `POST /api/v1/auth/mfa/setup`, `…/mfa/confirm`, `…/mfa/disable`) while signed in. There is no screen for this yet, and no
self-service password reset. Two-step verification is optional; an organization-wide "require MFA" policy does not exist yet. Changing a password signs out the
user's other sessions.

## How facilities and departments are managed

The organization itself is created by a platform administrator. Facilities (clinics, laboratories, dental clinics …) and their departments are managed through
the API:

| Task                       | API call                                                           | Permission                                  |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| View the organization      | `GET /api/v1/organization`                                         | `organization.read`                         |
| Facilities you can work in | `GET /api/v1/auth/me/facilities` (the facility selector)           | Any signed-in user                          |
| List or view facilities    | `GET /api/v1/facilities`, `GET /api/v1/facilities/{facilityId}`    | `organization.read`                         |
| Create a facility          | `POST /api/v1/facilities`                                          | `organization.manage`                       |
| Update a facility          | `PATCH /api/v1/facilities/{facilityId}` (with its current version) | `organization.manage`                       |
| List or create departments | `GET` / `POST /api/v1/facilities/{facilityId}/departments`         | `organization.read` / `organization.manage` |

A facility records its type, Philippine address, contact details, licence number (recorded for reference, not validated), time zone and status. Only
**active** facilities appear in the staff app's facility selector. Facility changes are audited with a before/after record.

## Where each setting lives

Settings are kept with the module they govern. "Screen" means the staff app; "API only" means there is no screen yet.

| Setting                                                                                                                         | Where                                                                                      | Permission to change         | See chapter                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Users, roles, role grants                                                                                                       | API only                                                                                   | `user.manage`, `role.manage` | this chapter                                                                                              |
| Facilities and departments                                                                                                      | API only                                                                                   | `organization.manage`        | this chapter                                                                                              |
| Practitioners (and their link to a staff account), rooms, schedules, schedule exceptions, coding systems                        | API only (`/api/v1/clinic/…`)                                                              | `clinic.configure`           | [Appointments and queue](03-appointments-and-queue.md)                                                    |
| Visit types patients may book online                                                                                            | Screen: `/appointments/visit-types`                                                        | `clinic.configure`           | [Appointments and queue](03-appointments-and-queue.md)                                                    |
| Services and prices, discount rules, payers, packages, tax and documents, document numbers                                      | Screen: `/billing/settings`                                                                | `billing.pricelist.manage`   | [Billing](10-billing.md)                                                                                  |
| PhilHealth accreditation number, PhilHealth YAKAP participation reference (per facility)                                        | Screen: `/billing/settings` (facility selected)                                            | `philhealth.settings.manage` | [Billing](10-billing.md)                                                                                  |
| Laboratory tests, reference ranges, panels, reference laboratories and referred tests                                           | Screen: `/laboratory/catalog`                                                              | `lab.catalog.manage`         | [Laboratory](06-laboratory.md)                                                                            |
| Laboratory policy per facility (self-verification and self-approval, release on approval, QC rules, QC and competency required) | Screen: `/laboratory/catalog` → **Laboratory policy**                                      | `lab.catalog.manage`         | [Laboratory](06-laboratory.md), [Laboratory quality](07-laboratory-quality.md)                            |
| Instruments, QC materials, lots and targets                                                                                     | Screens: `/laboratory/instruments`, `/laboratory/qc`                                       | `lab.qc.manage`              | [Laboratory quality](07-laboratory-quality.md)                                                            |
| Dental procedures, tooth notation, MyHealth dental records and online plan decisions, supply locations                          | Screen: `/dental/settings`                                                                 | `dental.settings.manage`     | [Dental](08-dental.md)                                                                                    |
| Inventory items, suppliers, storage locations, reorder levels                                                                   | Screen: `/inventory/catalog`                                                               | `inventory.catalog.manage`   | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                    |
| Reportable conditions (DOH), the facility's DOH health facility code, checking earlier diagnoses                                | Screen: `/reporting/settings`                                                              | `doh.settings.manage`        | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Integration payload keys                                                                                                        | Deployment configuration (usage shown on `/admin/integrations` to platform administrators) | IT / platform administrator  | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Payment provider, PhilHealth, DOH and reference-laboratory adapters                                                             | Not configured: no adapter exists yet (integration dependencies)                           | —                            | [Billing](10-billing.md), [Records, reporting and integrations](11-records-reporting-and-integrations.md) |
| Session length, which organization the portal serves                                                                            | Deployment configuration                                                                   | IT                           | —                                                                                                         |

## How to review integrations

**Administration → Integrations** (`/admin/integrations`) lists requests to external systems that did not succeed or are stalled. You can re-queue stalled
ones or resolve others with a note. It needs `integration.exchange.manage` (organization administrators by default). Platform administrators also see which
payload key ids stored values still need. Because no PhilHealth, DOH, payment or reference-laboratory adapter is configured by default, nothing is actually
transmitted to those systems. Details are in [Records, reporting and integrations](11-records-reporting-and-integrations.md).

> The **Administration** menu entry is shown to anyone with `user.read`, `user.manage`, `role.manage`, `organization.manage` or
> `integration.exchange.manage`, but its only page needs `integration.exchange.manage`. Without it, selecting **Administration** returns you to the
> dashboard.

## The audit trail

Every sensitive action is recorded in an append-only audit trail that cannot be changed or deleted. Each entry records who, what action, when, which
organization, facility and patient, which record, the outcome, the reason where one is required, before/after values where appropriate, the request
reference, IP address and browser.

Examples of what is recorded: sign-ins (successful, failed, lockouts, verification codes), sign-outs, password and two-step verification changes, access
denials, user and role changes, facility changes, every patient record view and search, registration (including duplicate overrides with the reason),
consent, portal invitations and disabling, timeline views, document uploads and downloads, clinical documentation, prescriptions and decision-support
overrides, laboratory result actions, billing actions, PhilHealth, DOH and FHIR actions.

**Reading the audit trail.** There is no audit screen yet. Users with `audit.read` (Auditor, Organization administrator) query it through
`GET /api/v1/audit-events`, filtered by patient, user (actor), record type and id, action, and time range. Each search is itself audited.

When staff see "(ref xxxxxxxx)" at the end of an error message, that is the start of the request reference. It helps IT find the matching log and audit
entries.

## Data privacy notes

- **Minimum necessary.** Search results show only what is needed to identify a patient, with a masked mobile number. Browser tab titles never show patient
  names. The timeline shows summaries only, and hides kinds of records a role may not read.
- **Least privilege.** Grant the narrowest role that fits the job, per facility where possible. Review role grants when staff change jobs or leave, and suspend
  their membership on their last day. Suspension ends access immediately.
- **Consent.** Record patient consent decisions as given (see [Patients](02-patients.md)). MyHealth access needs the portal access consent, and withdrawing it
  ends access. Outreach messages respect the patient's communication preferences.
- **Messages.** SMS and email never contain clinical details. Free-text staff messages go only to the patient's MyHealth inbox.
- **Files.** Documents, reports and images are kept in private, encrypted storage and opened with links that expire after a few minutes. Each opening is
  audited.
- **Shared workstations.** The staff app has no inactivity time-out. Train staff to sign out of shared computers.
- **Retention.** Data retention periods and deletion or anonymization procedures are not defined in the platform. Define them with your Data Protection Officer
  against current National Privacy Commission guidance.
- **No compliance claim.** Having these features does not make an organization compliant with the Data Privacy Act or any DOH, PhilHealth or BIR requirement.
  Compliance must be assessed against current official requirements before use in production.

## Rules the system enforces

- Every request is authorized on the server with the user's current permissions for the selected facility; hiding a button is never the only protection.
- Nobody can grant permissions they do not hold. Nobody can suspend their own membership.
- A role granted for a facility applies only while that facility is selected.
- Users and patients of one organization are never visible to another organization.
- Accounts lock for 15 minutes after 5 failed sign-in attempts; passwords need at least 12 characters.
- Audit entries cannot be updated or deleted.

## Troubleshooting / common messages

| Message                                                                           | Meaning                                                                  | What to do                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| You do not have permission to perform this action                                 | The user's roles do not include the permission at the selected facility. | Check their role grants and whether the grant is limited to another facility.             |
| A staff member sees no facility selector                                          | They hold no role in any active facility.                                | Grant a role for the organization or for their facility.                                  |
| Facility is not accessible                                                        | The selected facility is inactive or not in the organization.            | Select an active facility.                                                                |
| You cannot grant permissions you do not hold                                      | The role contains permissions the granting user lacks.                   | Ask an organization administrator to grant it.                                            |
| The user already has this role in this scope                                      | The same role is already granted at that level.                          | No action needed.                                                                         |
| This person is already a member of the organization                               | The email is already a member.                                           | Grant roles instead of adding them again.                                                 |
| initialPassword is required for a new account                                     | The email is new to the platform.                                        | Provide an initial password of at least 12 characters and share it securely.              |
| You cannot change your own membership status                                      | Self-suspension or self-reactivation is blocked.                         | Ask another administrator.                                                                |
| Facility was modified by someone else (expected version …). Reload and try again. | Someone changed the facility at the same time.                           | Read the facility again and repeat the change with the new version.                       |
| Too many failed attempts. Try again later.                                        | The account is locked for 15 minutes.                                    | Wait, then have the user sign in again. Investigate repeated lockouts in the audit trail. |

## Related chapters

- [Getting started](01-getting-started.md)
- [Patients](02-patients.md)
- [Appointments and queue](03-appointments-and-queue.md)
- [Laboratory](06-laboratory.md)
- [Laboratory quality](07-laboratory-quality.md)
- [Dental](08-dental.md)
- [Pharmacy and inventory](09-pharmacy-and-inventory.md)
- [Billing](10-billing.md)
- [Records, reporting and integrations](11-records-reporting-and-integrations.md)
- [Glossary and FAQ](14-glossary-and-faq.md)
