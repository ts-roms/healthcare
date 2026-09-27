# Billing (`libs/billing`)

## Purpose

What a patient was charged, what they and their payers owe, and what was paid (CLAUDE.md §18, `libs/billing/CLAUDE.md`):
charge capture from clinical work, invoices with discounts (including statutory Senior Citizen / PWD discounts) and
payer coverage (HMO, PhilHealth, insurers, companies), patient payments and refunds, and a daily report.

Billing is separate from clinical logic: it consumes clinical events, reads clinical facts only through the
`BillingSources` port, and never blocks a clinical workflow. Not in scope yet: online payment (a payment provider is an
integration dependency), PhilHealth eClaims submission (billing records coverage, references and claim status only),
packages, deposits/advance payments, credit/debit notes (corrections are void + reissue), VAT computation and
BIR-compliant official receipts (compliance dependencies, below).

## Money

Integer **centavos** (PHP) everywhere: `bigint` columns, integer JSON numbers in the API (`50000` = ₱500.00), never
floating point. Percentages are basis points (`2000` = 20%). Rounding: **half up to the centavo** per line
(`money.ts#percentOf`). The database checks every total (`net = gross − discount`, `patient = net − payer`, line
`gross = unit × quantity`).

## Entities

- `billing_service` — billable service (code, name, category: consultation, procedure, laboratory, dental,
  telemedicine, supply, other), optionally mapped to a clinical source for automatic capture: a **visit type code**
  (charged when an encounter of that visit type is signed) or a **laboratory test code** (charged when ordered).
- `billing_service_price` — versioned prices with effective dates (no overlaps: exclusion constraint). Adding a price
  ends the previous one the day before; charges and invoice lines keep the price they used.
- `billing_payer` — HMO, PhilHealth, insurer, company.
- `billing_discount_rule` — rate (basis points), categories it applies to (none = all), `statutory`,
  `requires_evidence` (always for statutory), `stackable`, effective dates. A changed rule is a new row.
- `billing_charge` — one billable thing for a patient at a facility: source (`encounter`, `lab_order_item`, `manual`),
  price snapshot, service date, status `pending → invoiced` (on a draft or issued invoice) or `cancelled` (reason).
  Unique per clinical source and service, so event redelivery charges once.
- `billing_invoice` (+ `_item`, `_discount`, `_payer`) — `draft → issued → void`. Numbered on issue
  (`INV-2026-000001`; prefix configurable). **Issued invoices and their lines are immutable** (triggers); only payer
  claim status may change after issue. A void records the reason and the replacement draft.
- `billing_payment` — append-only ledger of patient payments and refunds (method: cash, card, e-wallet, bank transfer,
  check, other; reference; receipt number `AR-2026-000001`), each with a unique idempotency key.
- `billing_sequence` — document number series per organization.

## Rules

- **Capture** (`ChargeCapture`, outbox handlers): `EncounterCompleted` → the visit type's service (signed encounters
  only); `LaboratoryOrderCreated` → one charge per non-cancelled item with a mapped test; `LaboratoryOrderCancelled` →
  its pending charges are cancelled (invoiced ones need a void). Unmapped or unpriced sources are not charged and do not
  fail the clinical workflow; staff add a manual charge.
- **Manual charges** use the listed price; another price needs a reason (audited with both prices).
- **Drafts** gather a patient's pending charges at the facility (all, or chosen ones); lines can be removed (the charge
  returns to pending); a draft can be discarded. Every change recomputes discounts and totals.
- **Discounts** apply to the lines of their categories, one after another on what remains (`billing.rules.ts`). A rule
  that requires evidence needs the ID number (e.g. OSCA or PWD ID), stored for audit and claims and shown masked
  (`•••• 4512`). Non-stackable discounts are not combined (statutory discounts included, unless configured otherwise
  after verification).
- **Payer coverage** (HMO LOA, PhilHealth, insurer) is an amount per payer with a reference; it cannot exceed the total
  after discounts. The patient owes the rest. After issue, coverage is followed up: `submitted`, `settled` (amount, not
  more than the coverage) or `denied`. A shortfall or denial is corrected by void + reissue with the new coverage.
- **Payments** only on issued invoices, never more than the patient's balance (change is given at the counter); the
  same idempotency key replays the recorded payment, a different transaction with it is refused.
- **Refunds** need `billing.refund.issue` and a reason, and never exceed what is left of the payment.
- **Void** needs `billing.invoice.void` and a reason, and only when nothing is paid (refund first) and no payer has
  settled. By default the charges, discounts (with their evidence) and coverage move to a new draft.

## Commands

Create service / add price / update service; create payer; create or deactivate discount rule; set number prefixes;
add or cancel a charge; create draft, remove line, apply or remove discount, set or remove payer coverage, discard,
issue, void; update claim status; record payment; refund.

## Queries

Services with price history and current price; payers; discount rules; cashier worklist (patients with pending charges
at the facility); charges; invoices (by patient, status, date, unpaid) with paid total and balance; one invoice with
lines, discounts, coverage and ledger; daily report; the patient's own invoices (MyHealth).

## Events

`ChargeCaptured`, `InvoiceIssued`, `InvoiceVoided`, `ClaimStatusChanged`, `PaymentCompleted`, `RefundIssued` (ids,
amounts and statuses only). Consumed: `EncounterCompleted`, `LaboratoryOrderCreated`, `LaboratoryOrderCancelled`.

## Permissions

`billing.charge.read`, `billing.charge.capture`, `billing.invoice.issue`, `billing.invoice.void`,
`billing.payment.record`, `billing.refund.issue`, `billing.discount.apply`, `billing.pricelist.manage`,
`billing.report.read`. New role **cashier**: read, capture, issue, payments, discounts, reports (not void, refund or
price list). Receptionists can read. Organization administrators hold all. Charges, invoices, payments and reports
require facility context (`X-Facility-Id`).

## API

`/billing/services` (+ `:id`, `:id/prices`), `/billing/payers`, `/billing/discount-rules` (+ `:id/deactivate`),
`/billing/settings`, `/billing/worklist`, `/billing/charges` (+ `:id/cancel`), `/billing/invoices` (+ `:id`,
`:id/items/:itemId`, `:id/discounts[/:discountId]`, `:id/payers[/:invoicePayerId[/status]]`, `:id/discard`,
`:id/issue`, `:id/void`, `:id/payments`), `/billing/payments/:id/refund`, `/billing/reports/daily?date=`. Patient:
`GET /portal/billing` (issued and void invoices; no drafts, notes, staff or evidence). Every read of patient billing is
audited; patient reads as actor type `patient`.

## Database relationships

Migration `0019_billing.sql`. Patient and facility references use `(organization_id, id)` keys; clinical sources are
referenced by type and id only (no foreign keys into clinical tables). Triggers: issued invoices immutable (void only),
lines of issued invoices immutable, payments append-only.

## Integration points

- `BillingSources` port (`apps/api/src/app/adapters/billing-adapters.ts`) over `ClinicQueries.billableEncounter` and
  `LabOrderService.billableOrder`; `BillingPatientDirectory` for minimal patient identification in lists.
- `InvoiceService` (exported) serves MyHealth billing.

## Screens

Staff (`billing.charge.read`, facility selected): `/billing` — the cashier's desk (patients with charges to invoice,
drafts, balances owed); `/billing/patients/[id]` — pending charges (tick what to invoice, add a charge at the listed or
another price with a reason, cancel with a reason) and the patient's invoices (also linked from the patient record);
`/billing/invoices` — by day, drafts, balance owed, issued, void; `/billing/invoices/[id]` — the invoice workspace:
lines, discounts (evidence ID entered, shown masked), HMO/PhilHealth coverage with LOA reference, totals, issue or
discard; once issued: payments (idempotency key per payment), refunds, claim follow-up (submitted / settled / denied),
void with reason and optional reissue; `/billing/reports` — the daily report; `/billing/settings` — services and prices
(charged automatically for a visit type or laboratory test, or only by staff), discount rules (with the statutory
compliance warning), payers, document prefixes. MyHealth: `/billing` ("Bills" on the home screen) — issued and void
invoices with lines, discounts, coverage, payments and balance; paying online is not available.

## Printable documents

Invoices (drafts watermarked, voids marked) and acknowledgement receipts as PDFs (`BillingDocuments`), for staff and —
issued invoices only — the patient in MyHealth. See [printable-documents.md](../architecture/printable-documents.md).

## Compliance dependencies / assumptions

- **BIR:** invoice and receipt format, numbering, and whether the acknowledgement receipt may serve as an official
  receipt must be validated; prefixes and series are configuration. VAT is not computed (amounts are as priced);
  VAT treatment of medical services and of statutory discounts must be confirmed and configured before production.
- **Statutory discounts (RA 9994, RA 10754):** rates, covered services, VAT exemption and combination rules are
  configuration to be verified against current issuances. Nothing is hard-coded; no rule is seeded.
- **PhilHealth:** coverage amounts and claim references are recorded manually; eClaims is an integration dependency.
- **Payment provider** (cards/e-wallets online): an integration dependency; MyHealth shows balances only.
