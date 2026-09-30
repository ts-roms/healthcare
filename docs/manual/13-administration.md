# 13. Administration

**What this is for.** This chapter is for the people who set up and look after the platform for an organization: which roles exist and what each may do by
default, how staff accounts, roles, facilities and departments are managed, where each configurable setting lives, how the audit trail works, and the data
privacy points administrators should know.

**Who uses it.** Organization administrators, IT staff who support them, records officers and auditors. Other staff can read the roles section to understand
why a button or menu is missing.

> A few administration tasks still have **no screen in the staff app**: defining diagnosis coding systems, and changing or retiring a role once created.
> They are done through the platform's REST API (`/api/v1`, documented at `/api/docs` on the API server) by someone with the right permission. There is no way
> yet for an administrator to reset another person's password (two-step verification can be reset: see "Two-step verification for staff" below).

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

| Permission            | What it allows                                                                                               | Default roles (besides Organization administrator)                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.read`          | View the audit trail                                                                                         | Auditor                                                                                                                                                                     |
| `organization.manage` | Manage organization settings, facilities and departments                                                     | —                                                                                                                                                                           |
| `organization.read`   | View organization, facilities and departments                                                                | Auditor, Dental assistant, Dentist, Inventory officer, Medical records officer, Medical technologist, Nurse, Pathologist, Pharmacist, Phlebotomist, Physician, Receptionist |
| `role.manage`         | Create and edit organization roles                                                                           | —                                                                                                                                                                           |
| `user.manage`         | Create staff users, grant and revoke roles                                                                   | —                                                                                                                                                                           |
| `user.mfa.manage`     | Require two-step verification for staff, exempt integration accounts, reset a member's two-step verification | —                                                                                                                                                                           |
| `user.read`           | View staff users and their role assignments                                                                  | —                                                                                                                                                                           |

### Patients and documents

| Permission               | What it allows                                                    | Default roles (besides Organization administrator)                                                                                                       |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.archive`       | Archive documents                                                 | Medical records officer                                                                                                                                  |
| `document.read`          | Download documents                                                | Dental assistant, Dentist, Medical records officer, Nurse, Physician                                                                                     |
| `document.upload`        | Upload documents                                                  | Dental assistant, Dentist, Medical records officer, Nurse, Physician, Receptionist                                                                       |
| `notification.read`      | View the communication log and patients' communication history    | Dentist, Medical records officer, Physician, Receptionist                                                                                                |
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

### Immunizations

| Permission            | What it allows                                                                                | Default roles (besides Organization administrator) |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `immunization.read`   | View a patient's immunization history and the vaccine catalogue                               | Dentist, Medical records officer, Nurse, Physician |
| `immunization.record` | Record doses given, not given or reported, add a reaction, and mark a record entered in error | Nurse, Physician                                   |

The vaccine catalogue is changed with `clinic.configure`. Give `immunization.record` to other staff who vaccinate (for example midwives or
pharmacists) through your own roles, as your policy allows.

### Patient history

| Permission       | What it allows                                                                                                                                                                  | Default roles (besides Organization administrator) |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `history.read`   | View a patient's past procedures and conditions, medications taken, family and social history (substance use and sexual history also need `encounter.write`)                    | Dentist, Medical records officer, Nurse, Physician |
| `history.record` | Record past procedures and conditions, medications taken (and mark them stopped), family history and its review, new social history versions, and mark entries entered in error | Dentist, Nurse, Physician                          |

Who sees the private parts of the social history follows `encounter.write`; change it through your own roles, as your data protection officer
advises.

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

| Permission                    | What it allows                                                                                                      | Default roles (besides Organization administrator) |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `doh.report.manage`           | Review disease case reports: confirm, record as reported, dismiss, submit                                           | Dentist, Medical records officer, Physician        |
| `doh.settings.manage`         | Configure reportable conditions and the facility's DOH health facility code                                         | —                                                  |
| `integration.exchange.manage` | Review outbound integration exchanges: see failures, re-queue stalled ones, record a resolution                     | —                                                  |
| `interop.fhir.import`         | Submit FHIR R4 content for import (received into the review queue, never into the record; audited)                  | —                                                  |
| `interop.fhir.import.review`  | Review FHIR imports: view received content, match the patient, accept or reject entries (audited)                   | Medical records officer                            |
| `interop.fhir.read`           | Read patient records through the FHIR R4 interface (whole-record export; audited)                                   | —                                                  |
| `management.dashboard.read`   | View the management dashboard and download its tables (aggregate figures; revenue also needs `billing.report.read`) | —                                                  |

**Things to notice in the defaults:**

- Several powerful actions are held only by the organization administrator: voiding invoices, refunds, credit and debit notes, price lists, DOH settings,
  PhilHealth settings, dental settings, clinic configuration, approving purchase orders, integration review, FHIR read and import, and all user, role and
  organization management. Grant them to a custom role if someone else must do them.
- The facility selector lists the facilities where a person holds a role (every facility for an organization-wide role). It does not need
  `organization.read`, so a cashier-only user can choose their facility.
- The **Auditor** role reads the audit trail at **Administration → Audit log** (see below).

## How staff accounts are managed

**Administration → Staff users** (`/admin/users`, needs `user.read`; changes need `user.manage`) lists everyone in the organization with their status,
two-step verification, roles (and where each applies) and last sign-in. Every change below is audited.

1. **Add a person:** click **Add staff member**, enter their work email and the name to show. If the email is new to the platform, also set a **first
   password** (at least 12 characters) and give it to them in person; someone who already has an account keeps their own password. You are taken to their
   page to give them a role — without one they can sign in but see nothing.
2. **Grant a role:** on the person's page, under **Grant a role**, choose the role and **Where**: organization-wide, one facility, or one department of a
   facility. Click **Grant**. Roles containing permissions you do not hold yourself are not offered.
3. **Revoke a role:** click **Revoke…** next to it, give the reason and confirm. Revoked assignments are kept in history.
4. **Suspend or reactivate:** click **Suspend…** (or **Reactivate…**), give the reason and confirm. Suspension signs the person out everywhere at once. You
   cannot suspend yourself.

**Administration → Roles** (`/admin/roles`, needs `user.read`) shows every role and its permissions. With `role.manage`, **New role…** creates your
organization's own role: a name, a key (lower-case letters, digits and underscores), an optional description, and the permissions — only those you hold
yourself can be ticked. Roles cannot be changed or retired from the screen yet; create a new role and re-grant it instead.

**Rules for granting access:**

- Nobody can grant a role, or create a role, containing permissions they do not hold themselves ("You cannot grant permissions you do not hold").
- A user's permissions are recalculated on every request, so a grant or revocation takes effect at their next action. The sidebar updates on the next page
  load.
- To link a staff account to a practitioner (needed to sign encounters, prescribe and record dental work), use the clinic set-up calls below.

**Passwords and two-step verification.** Each person changes their own password and turns two-step verification on or off under **My account** (click
their name in the top bar; see [Getting started](01-getting-started.md)). Changing a password signs out the person's other sessions. Staff who forget their
password can reset it themselves with **Forgot your password?** on the sign-in page (a link to their sign-in email; the platform's `STAFF_BASE_URL` must be
set). Two-step verification can be required for everyone (below).

**Temporary password** (needs `user.manage`; check who they are in person first): on the person's page, under **Account**, select **Reset password…**.
Enter a **Temporary password** (at least 12 characters) twice and a **Reason** (for example "forgot password, confirmed in person"), then **Set temporary
password**. Give it to them directly — never by email or chat. They are signed out everywhere, a lockout is cleared, and their page shows **Temporary
password**. When they sign in with it, every page asks them to **Choose your own password** first. It is audited with your reason. You cannot reset your
own account, and an account also used in another organization can only be reset by a platform administrator ("This account is also used outside your
organization").

## Two-step verification for staff

**Administration → Sign-in security** (`/admin/security`, needs `user.read`; changes need `user.mfa.manage`, organization administrators by default) shows
whether your organization requires two-step verification, how many active members have it on, are exempt or still lack it, the list of those still
without it, and the exempt accounts. Every change is audited.

1. **Turn on your own first.** You can require it only once your own account uses it (**My account**).
2. **Exempt integration accounts before requiring it.** Accounts that sign in without a person — the instrument gateway's, a system that sends FHIR
   imports — cannot type a code. Open the account under **Staff users**, click **Exempt from two-step verification…**, give the reason (for example
   "Instrument gateway integration account") and confirm. Remove an exemption there or on **Sign-in security**. You cannot exempt yourself.
3. **Require it:** click **Require it for all staff…**, optionally give a reason, and confirm. From their next page, a member without it sees only **Set up
   two-step verification**: nobody is locked out, but they cannot open anything else until it is on, and nobody can turn theirs off while it is required.
   **Stop requiring it…** undoes this.
4. **Lost or replaced phone:** a person with recovery codes left signs in with one and turns it on again from **My account**. Otherwise, check who is asking (in person, or by a call you place to a number you already have), open their page under **Staff users**
   and click **Reset two-step verification…** with the reason. Their sessions end at once and they set it up again at their next sign-in. You cannot reset
   your own (use **My account**), and an account that also belongs to another organization can only be reset by a platform administrator.

## How facilities and departments are managed

The organization itself is created by a platform administrator. **Administration → Facilities** (`/admin/facilities`, needs `organization.read`; changes
need `organization.manage`) shows each facility (clinics, laboratories, dental clinics …) with its departments.

1. **Add a facility:** click **New facility**, enter a code (lower-case letters, digits and hyphens; it cannot change later), the name, type and, if you
   like, the address, contact details and licence number. Click **Add facility**.
2. **Change a facility:** click **Edit…**, change the details or set it **Inactive**, and click **Save**. If someone else saved it meanwhile, the page
   refreshes and asks you to check again.
3. **Add a department:** click **Add department…**, enter its name and code, and click **Add**. Departments can then be used to grant a role to one
   department of a facility.

A facility records its type, Philippine address, contact details, licence number (recorded for reference, not validated), time zone and status. Only
**active** facilities appear in the staff app's facility selector. Facility changes are audited with a before/after record.

## Where each setting lives

Settings are kept with the module they govern. "Screen" means the staff app; "API only" means there is no screen yet.

| Setting                                                                                                                            | Where                                                                                      | Permission to change            | See chapter                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Users, roles, role grants                                                                                                          | Screens: `/admin/users`, `/admin/roles`                                                    | `user.manage`, `role.manage`    | this chapter                                                                                              |
| Facilities and departments                                                                                                         | Screen: `/admin/facilities`                                                                | `organization.manage`           | this chapter                                                                                              |
| Practitioners (and their link to a staff account), rooms, weekly schedules, closures                                               | Screen: `/appointments/schedules`                                                          | `clinic.configure`              | [Appointments and queue](03-appointments-and-queue.md)                                                    |
| Diagnosis coding systems                                                                                                           | API only (`/api/v1/clinic/coding-systems`)                                                 | `clinic.configure`              | this chapter                                                                                              |
| Visit types patients may book online                                                                                               | Screen: `/appointments/visit-types`                                                        | `clinic.configure`              | [Appointments and queue](03-appointments-and-queue.md)                                                    |
| Vaccine catalogue (names, products, codes, route and site options, doses in series for reference)                                  | Screen: `/clinic/vaccines` (**Clinic → Vaccines**)                                         | `clinic.configure`              | [Patients](02-patients.md)                                                                                |
| Procedure catalogue (your own codes and names, another code if you use one, whether the body site is asked, supplies usually used) | Screen: `/clinic/procedures` (**Clinic → Procedures**)                                     | `clinic.configure`              | [Consultations](04-consultations-and-care-plans.md)                                                       |
| Services and prices, discount rules, payers, packages, tax and documents, document numbers                                         | Screen: `/billing/settings`                                                                | `billing.pricelist.manage`      | [Billing](10-billing.md)                                                                                  |
| PhilHealth accreditation number, PhilHealth YAKAP participation reference (per facility)                                           | Screen: `/billing/settings` (facility selected)                                            | `philhealth.settings.manage`    | [Billing](10-billing.md)                                                                                  |
| Laboratory tests, reference ranges, panels, reference laboratories and referred tests                                              | Screen: `/laboratory/catalog`                                                              | `lab.catalog.manage`            | [Laboratory](06-laboratory.md)                                                                            |
| Laboratory policy per facility (self-verification and self-approval, release on approval, QC rules, QC and competency required)    | Screen: `/laboratory/catalog` → **Laboratory policy**                                      | `lab.catalog.manage`            | [Laboratory](06-laboratory.md), [Laboratory quality](07-laboratory-quality.md)                            |
| Instruments, QC materials, lots and targets                                                                                        | Screens: `/laboratory/instruments`, `/laboratory/qc`                                       | `lab.qc.manage`                 | [Laboratory quality](07-laboratory-quality.md)                                                            |
| Reagent tests per unit (how many tests one stock unit of a reagent performs)                                                       | Screen: `/laboratory/reagents` → **Tests per unit**                                        | `lab.qc.manage`                 | [Laboratory quality](07-laboratory-quality.md)                                                            |
| Dental procedures, tooth notation, MyHealth dental records and online plan decisions, supply locations                             | Screen: `/dental/settings`                                                                 | `dental.settings.manage`        | [Dental](08-dental.md)                                                                                    |
| Inventory items, suppliers, storage locations, reorder levels                                                                      | Screen: `/inventory/catalog`                                                               | `inventory.catalog.manage`      | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                    |
| Reportable conditions (DOH), the facility's DOH health facility code, checking earlier diagnoses                                   | Screen: `/reporting/settings`                                                              | `doh.settings.manage`           | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Withholding codes and procurement methods                                                                                          | Screen: `/inventory/compliance`                                                            | `inventory.procurement.approve` | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                    |
| Controlled register details (licence reference, responsible person; per facility)                                                  | Screen: `/inventory/controlled-register`                                                   | `inventory.catalog.manage`      | [Pharmacy and inventory](09-pharmacy-and-inventory.md)                                                    |
| Laboratory licence (per facility)                                                                                                  | Screen: `/laboratory/licence`                                                              | `lab.qc.manage`                 | [Laboratory quality](07-laboratory-quality.md)                                                            |
| Document retention periods                                                                                                         | Screen: `/records/retention`                                                               | `document.retention.manage`     | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Records-request procedure (response time, identity check, notice to patients)                                                      | Screen: `/records/requests/settings`                                                       | `organization.manage`           | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Compliance reviews (who validated each area's configuration)                                                                       | Screen: `/admin/compliance`                                                                | `compliance.review.manage`      | this chapter                                                                                              |
| Integration payload keys                                                                                                           | Deployment configuration (usage shown on `/admin/integrations` to platform administrators) | IT / platform administrator     | [Records, reporting and integrations](11-records-reporting-and-integrations.md)                           |
| Payment provider, PhilHealth, DOH and reference-laboratory adapters                                                                | Not configured: no adapter exists yet (integration dependencies)                           | —                               | [Billing](10-billing.md), [Records, reporting and integrations](11-records-reporting-and-integrations.md) |
| Session length, which organization the portal serves                                                                               | Deployment configuration                                                                   | IT                              | —                                                                                                         |

## How to review integrations

**Administration → Integrations** (`/admin/integrations`) lists requests to external systems that did not succeed or are stalled. You can re-queue stalled
ones or resolve others with a note. It needs `integration.exchange.manage` (organization administrators by default). Platform administrators also see which
payload key ids stored values still need. Because no PhilHealth, DOH, payment or reference-laboratory adapter is configured by default, nothing is actually
transmitted to those systems. Details are in [Records, reporting and integrations](11-records-reporting-and-integrations.md).

> The **Administration** menu entry appears only for people who can open one of its pages: **Staff users** and **Roles** (`user.read`), **Facilities**
> (`organization.read`), **Audit log** (`audit.read`), **Integrations** (`integration.exchange.manage`), **Compliance** (`compliance.review.manage`) or
> **Consent wording** (`consent.wording.manage`). **Administration** itself lists the pages open to you.

## How to write the consent wording for online consent

Patients can give some consents themselves in MyHealth, but only after reading **your organization's own wording**. The platform provides no wording and does
not say what a consent legally needs: have your data protection officer approve the text. Needs `consent.wording.manage` (organization administrators).

1. Open **Administration → Consent wording**. Each consent patients may give online (**Online consultations**, **Sharing with the patient's HMO**, **Sharing
   with PhilHealth**, **Research**) shows whether it is offered and its version.
2. Enter the **Title patients see**, **The wording**, and the **Statement the patient confirms**, then choose **Publish and offer online** (or **Publish as a new
   version** to change it). Versions are never edited: each save is a new one, and patients who are reading see the new one before they can give.
3. To stop offering a consent online, choose **Stop offering online**. Patients then give it at the clinic. Consents already given stay as they are.

The patient's record shows a consent given online as "by the patient in MyHealth" with **wording v…**, the version they read. Consent to the use of
information, to general treatment, and to MyHealth itself is always given at the clinic.

## How to record compliance reviews

The platform does not know BIR, Dangerous Drugs Board, DOH, National Privacy Commission or public procurement rules. Everything in those areas
(tax settings, withholding codes, procurement methods, the controlled register, the laboratory licence, reporting rules and deadlines,
retention periods, the records-request procedure, dental written estimates) is your organization's own configuration. **Administration →
Compliance** (`/admin/compliance`; `compliance.review.manage`, organization administrators) keeps the record of who checked it.

1. Each area shows **Validated** with the date, **Changes needed**, or **Not reviewed**, with a link to its settings.
2. After your adviser (accountant, pharmacist, pathologist, Data Protection Officer…) checks an area against the current official requirements,
   click **Record a review…**, choose the outcome, enter the reviewer, their role, what they reviewed against and the date, and click
   **Save review**. Reviews cannot be changed; record a new one after the next check.

A recorded review is your organization's evidence, not a certification by the platform.

## The audit trail

Every sensitive action is recorded in an append-only audit trail that cannot be changed or deleted. Each entry records who, what action, when, which
organization, facility and patient, which record, the outcome, the reason where one is required, before/after values where appropriate, the request
reference, IP address and browser.

Examples of what is recorded: sign-ins (successful, failed, lockouts, verification codes), sign-outs, password and two-step verification changes, access
denials, user and role changes, facility changes, every patient record view and search, registration (including duplicate overrides with the reason),
consent, portal invitations and disabling, timeline views, document uploads and downloads, clinical documentation, prescriptions and decision-support
overrides, laboratory result actions, billing actions, PhilHealth, DOH and FHIR actions.

**Reading the audit trail.** **Administration → Audit log** (`/admin/audit`; `audit.read`: Auditor, Organization administrator) lists entries newest
first, 50 a page (**Older** / **Newer**). Filter by day range (local days), action (for example `patient.read`), record type (for example `patient`), staff
member and patient id, then click **Search**; **Clear** removes the filters. **Show** opens an entry's record id, before/after values, details and where the
request came from; **Open patient** goes to the patient concerned. Each search is itself recorded in the audit trail.

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
- When two-step verification is required, a member without it (and not exempt) can only set it up, and nobody can turn theirs off.
- Audit entries cannot be updated or deleted.

## Troubleshooting / common messages

| Message                                                                                     | Meaning                                                                        | What to do                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| You do not have permission to perform this action                                           | The user's roles do not include the permission at the selected facility.       | Check their role grants and whether the grant is limited to another facility.             |
| A staff member sees no facility selector                                                    | They hold no role in any active facility.                                      | Grant a role for the organization or for their facility.                                  |
| Facility is not accessible                                                                  | The selected facility is inactive or not in the organization.                  | Select an active facility.                                                                |
| You cannot grant permissions you do not hold                                                | The role contains permissions the granting user lacks.                         | Ask an organization administrator to grant it.                                            |
| The user already has this role in this scope                                                | The same role is already granted at that level.                                | No action needed.                                                                         |
| This person is already a member of the organization                                         | The email is already a member.                                                 | Grant roles instead of adding them again.                                                 |
| This email has no account yet: set a first password for them.                               | The email is new to the platform.                                              | Set a first password of at least 12 characters and give it to them in person.             |
| You cannot change your own membership status                                                | Self-suspension or self-reactivation is blocked.                               | Ask another administrator.                                                                |
| Facility was modified by someone else (expected version …). Reload and try again.           | Someone changed the facility at the same time.                                 | Read the facility again and repeat the change with the new version.                       |
| Too many failed attempts. Try again later.                                                  | The account is locked for 15 minutes.                                          | Wait, then have the user sign in again. Investigate repeated lockouts in the audit trail. |
| Your organization requires two-step verification. Set it up in My account to continue.      | The member has not set up the two-step verification the organization requires. | Set it up on the page shown; an integration account needs an exemption instead.           |
| Turn on two-step verification for your own account before requiring it                      | You tried to require it without using it yourself.                             | Turn it on under My account first.                                                        |
| This account also belongs to another organization; ask a platform administrator to reset it | The person signs in to more than one organization.                             | Ask a platform administrator.                                                             |

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
