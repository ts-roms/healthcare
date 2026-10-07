# Compliance configuration

No official text from the BIR, the Dangerous Drugs Board or FDA, DOH, the National Privacy Commission or the public
procurement rules (RA 9184) is on record, and CLAUDE.md §36 forbids inventing one. So the platform encodes **no**
government rule, rate, period, deadline, form or certification here. Each of the areas below gives the organization a
place to enter **its own** values, from the issuances and advice it follows, and a record of **who validated** them.
Nothing here makes the platform compliant: compliance is assessed by the organization's advisers against current
official requirements. Migration `0074_compliance_configuration.sql`.

## Compliance reviews (all areas)

`compliance_review` (`libs/organization/src/lib/compliance`, append-only): the area (`billing_tax`, `procurement`,
`controlled_drugs`, `laboratory_licensing`, `doh_reporting`, `data_privacy`, `dental_estimates`), the outcome
(`validated` or `changes_needed`), the reviewer's name and role (e.g. external accountant, pharmacist, pathologist, Data
Protection Officer), what the review was made against (their words), the review date (not in the future) and a note.
`GET /compliance/reviews` lists each area with its latest review and the history; `POST /compliance/reviews` records one
(`compliance.review.manage`, org_admin; audited `compliance.review.record`). Staff `/admin/compliance` (Admin →
Compliance) links each area to its settings.

## Tax and procurement (inventory)

- **Withholding codes** (`inventory_withholding_code`): the organization's own code, description and an optional rate
  kept **for reference only**. When a supplier invoice is paid, staff may enter the amount withheld under a code, and the
  reference of the certificate given to the supplier; the platform never computes a tax base or amount (only checks the
  amount is not above the invoice total). The invoice then shows what was withheld and what was paid to the supplier
  (`netPaid`). Recorded only with the payment (database constraints); a paid invoice never changes.
- **Procurement methods** (`inventory_procurement_method`): the organization's own methods, each optionally asking for a
  reference (its label, e.g. "Posting reference"). Once any method is in use, a purchase order names one before it is
  submitted, with the reference when the method asks for it (`procurement_method_required`,
  `procurement_reference_required`, `procurement_method_inactive`). Orders keep the method and reference.
- Routes: `GET|POST /inventory/withholding-codes`, `POST /inventory/withholding-codes/:id/deactivate`,
  `GET|POST /inventory/procurement-methods`, `POST /inventory/procurement-methods/:id/deactivate` (read: `inventory.read`;
  manage: `inventory.procurement.approve`). Staff `/inventory/compliance` (Tax and procurement), the payment card on
  the supplier invoice, and the new purchase order form.
- Payables: open and overdue supplier invoices already exist (`/inventory/supplier-invoices?status=open|overdue`). BIR
  forms, input VAT and accounts payable ledgers are not built (compliance dependency).

## Register of controlled items (inventory)

- `GET /inventory/controlled-register?from&to[&itemId][&locationId]` (selected facility,
  `inventory.controlled-register.read`: org_admin, pharmacist, inventory_officer; audited
  `inventory.controlled-register.view`) reads the append-only stock ledger for items flagged **controlled**: per item and
  location, the balance before the period (today's balance less everything since the period started), every movement in
  the period (oldest first) with its lot, reference (e.g. the prescription number of a dispense), recipient, reason and
  who recorded it, the running balance, and the closing balance. `…/export` gives the same as CSV (formula-safe,
  audited `inventory.controlled-register.export`). Composed in `apps/api/src/app/controlled-register` (the inventory
  library supplies the rows; the API adds staff names).
- Each facility's register header (`inventory_controlled_register_setting`): the licence reference and responsible
  person **as recorded** (not verified), and a note; `GET|PUT /inventory/controlled-register/setting` (write also needs
  `inventory.catalog.manage`; audited). Staff `/inventory/controlled-register`.
- The layout is the platform's own. Whether it serves as the register the Dangerous Drugs Board or FDA requires is a
  compliance dependency.

## Laboratory licence and DOH reporting deadlines

- **Licence** (`lab_facility_licence`, append-only; a renewal is a new record): the licence number, classification and
  issuing office as written, validity dates, the head of the laboratory and their licence number, and the organization's
  reminder window (days before expiry). `GET /laboratory/licence` (`lab.qc.read`) gives the current licence, its state
  (`missing`, `not_yet_valid`, `valid`, `expiring`, `expired`: dates only) and the history; `POST /laboratory/licence`
  (`lab.qc.manage`; audited `lab.licence.record`). The quality summary carries `licence`, and the dashboard lists an
  expired (critical), expiring (warning), not yet valid or missing (information) licence. Staff `/laboratory/licence`.
  Licensing rules are not encoded and the licence is not verified with DOH.
- **Reporting deadlines**: a reportable-condition rule may carry the organization's own "report within N days of the
  diagnosis" (`doh_reportable_rule.report_within_days`, 1–365, optional). A case report opened from it gets `due_at` (the
  diagnosis time plus the days), kept even if the rule changes, and is **overdue** while still pending review, queued,
  failed or rejected past it. Shown on the rules table and the case report list. No DOH deadline is suggested.

## Data Privacy Act: retention and records requests

- **Retention** (`document_retention_policy`, `libs/documents`): the organization's retention period (years) per document
  category, with where it comes from (its schedule, issuance or advice); setting a new period ends the previous one
  (kept as history). `GET|PUT /document-retention`, `POST /document-retention/:category/end`,
  `GET /document-retention/review?category=` (`document.retention.manage`: org_admin, records_officer; audited
  `document.retention.view | set | end | review`). The review lists available ordinary documents stored longer than the
  period, oldest first (at most 200; metadata only). **Nothing is deleted**: a document is archived from the patient
  record with a reason, as any document; disposal of the stored file follows the organization's procedure. Documents a
  domain manages itself (laboratory attachments) are left to it. Staff `/records/retention`.
- **Records-request procedure** (`records_request_setting`): a response time in days (each new request gets
  `respond_by`, shown to staff and in MyHealth; open requests past it are flagged `overdue`), whether staff must record how
  they confirmed the requester's identity before sharing (`identity_check_required`), and a notice patients read before
  asking (fees, identification, how answers are given — in the organization's words). `GET|PUT /records-requests/setting`
  (read: `patient.records-request.manage`; write also `organization.manage`; audited `patient.records-request.setting`).
  Staff `/records/requests/settings` ("Your procedure"); the answer form asks how identity was confirmed.

## Dental written estimates

- Settings (`dental_organization_setting`): how many days a printed estimate holds (printed as **Valid until**; none by
  default) and whether a decision recorded by staff needs the patient's signed written estimate.
- `POST /dental/treatment-plans/:id/written-estimates` (`dental.treatment-plan.manage`, with the plan's version)
  records that the patient signed today's printed estimate: the items it listed, its total (low and high), unpriced items,
  the pricing date and until when it holds (`dental_written_estimate`, append-only; audited `dental.plan.estimate.signed`).
  The estimate response lists them (`written`, `validUntil`, `writtenRequired`).
- When required, a staff-recorded decision is refused (`written_estimate_required`) unless a signed estimate listed every
  item awaiting the decision and still holds. Decisions patients make in MyHealth confirm the organization's
  acknowledgement text instead. Written-estimate requirements themselves are a compliance dependency.

## Permissions

`compliance.review.manage` (org_admin), `inventory.controlled-register.read` (org_admin, pharmacist,
inventory_officer), `document.retention.manage` (org_admin, records_officer), `document.integrity.manage` (org_admin,
records_officer; the integrity review of stored documents, `docs/domains/documents.md`); everything else reuses existing
permissions (see each section).
