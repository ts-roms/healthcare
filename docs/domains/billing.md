# Billing (`libs/billing`)

## Purpose

What a patient was charged, what they and their payers owe, and what was paid (CLAUDE.md §18, `libs/billing/CLAUDE.md`):
charge capture from clinical work, invoices with discounts (including statutory Senior Citizen / PWD discounts) and
payer coverage (HMO, PhilHealth, insurers, companies), patient payments and refunds, patient deposits (advance
payments) and account credit, credit notes, and a daily report.

Billing is separate from clinical logic: it consumes clinical events, reads clinical facts only through the
`BillingSources` port, and never blocks a clinical workflow. Not in scope yet: online payment (a payment provider is an
integration dependency), PhilHealth eClaims submission (billing records coverage, references and claim status only),
packages, debit notes, VAT computation and BIR-compliant official receipts and credit notes (compliance dependencies,
below).

## Money

Integer **centavos** (PHP) everywhere: `bigint` columns, integer JSON numbers in the API (`50000` = ₱500.00), never
floating point. Percentages are basis points (`2000` = 20%). Rounding: **half up to the centavo** per line
(`money.ts#percentOf`). The database checks every total (`net = gross − discount`, `patient = net − payer`, line
`gross = unit × quantity`).

## Entities

- `billing_service` — billable service (code, name, category: consultation, procedure, laboratory, dental,
  telemedicine, supply, other), optionally mapped to a clinical source for automatic capture: a **visit type code**
  (charged when an encounter of that visit type is signed), a **laboratory test code** (charged when ordered) or a
  **dental procedure code** (charged when performed; see [dental.md](dental.md)).
- `billing_service_price` — versioned prices with effective dates (no overlaps: exclusion constraint). Adding a price
  ends the previous one the day before; charges and invoice lines keep the price they used.
- `billing_payer` — HMO, PhilHealth, insurer, company.
- `billing_discount_rule` — rate (basis points), categories it applies to (none = all), `statutory`,
  `requires_evidence` (always for statutory), `stackable`, effective dates. A changed rule is a new row.
- `billing_charge` — one billable thing for a patient at a facility: source (`encounter`, `lab_order_item`,
  `dental_procedure`, `manual`),
  price snapshot, service date, status `pending → invoiced` (on a draft or issued invoice) or `cancelled` (reason).
  Unique per clinical source and service, so event redelivery charges once.
- `billing_invoice` (+ `_item`, `_discount`, `_payer`) — `draft → issued → void`. Numbered on issue
  (`INV-2026-000001`; prefix configurable). **Issued invoices and their lines are immutable** (triggers); only payer
  claim status may change after issue. A void records the reason and the replacement draft.
- `billing_payment` — append-only ledger of patient payments and refunds (method: cash, card, e-wallet, bank transfer,
  check, other; reference; receipt number `AR-2026-000001`), each with a unique idempotency key.
- `billing_sequence` — document number series per organization: `invoice`, `receipt` (payments and deposits),
  `credit_note`.
- `billing_credit_note` (+ `_line`) — a credit against lines of an issued invoice: number (`CN-2026-000001`; prefix
  configurable), reason, amount, split into `applied_amount` (reduced what the patient owed) and `account_credit`
  (already paid; credited to the patient's account). Append-only; a trigger allows them on issued invoices only.
- `billing_account_entry` — the patient's account per facility, an append-only ledger: `deposit` (+, method,
  reference, receipt number, idempotency key), `credit` (+, from a credit note), `application` (−, to an issued
  invoice, idempotency key), `release` (+, an application returned when its invoice is voided), `refund` (−, method,
  reason, idempotency key). The balance is derived from the ledger; a trigger refuses an application or refund beyond
  it.

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
- **Invoice balance** = patient's share − (payments − refunds) − (deposit applied − released) − credit notes' applied
  amounts (`billing.rules.ts#invoiceBalance`); it is what payments and deposit applications are checked against, in
  lists (`unpaid`), the invoice, its PDF and receipts.
- **Deposits** (advance payments) are recorded on the patient's account at the selected facility with a receipt from the
  receipt series; the same idempotency key replays the entry. The balance is applied to issued invoices of that patient
  and facility, partly or fully, never beyond the invoice balance or the account balance (`applicationProblem`).
  Unapplied balance is refunded with `billing.refund.issue` and a reason, never beyond the balance. Changes to one
  account are serialized (a transaction-scoped advisory lock taken after any invoice lock). A void returns the deposit
  applied to the invoice to the account (`release`); payments must still be refunded first.
- **Credit notes** (`billing.credit-note.issue`, reason) correct an issued invoice without voiding it: each line credits
  a line of the invoice, at most its net amount less earlier credits; together at most the patient's share less
  earlier credit notes (`creditNoteProblem`). Payer coverage is not credited (a claim matter, or void + reissue). The
  credit first reduces what the patient still owes; the rest — money already paid — becomes account credit
  (`splitCredit`), to apply to another invoice or refund. Credit notes are issued at once, numbered, immutable and
  idempotent per key. An invoice with a credit note is not voided (`invoice_has_credit_notes`); a further correction is
  another credit note (debit notes are not implemented).
- **Void** needs `billing.invoice.void` and a reason, and only when nothing is paid (refund first) and no payer has
  settled. By default the charges, discounts (with their evidence) and coverage move to a new draft.

## Commands

Create service / add price / update service; create payer; create or deactivate discount rule; set number prefixes;
add or cancel a charge; create draft, remove line, apply or remove discount, set or remove payer coverage, discard,
issue, void; update claim status; record payment; refund; record deposit; apply deposit or credit to an invoice;
refund deposit or credit; issue credit note.

## Queries

Services with price history and current price; payers; discount rules; cashier worklist (patients with pending charges
at the facility); charges; invoices (by patient, status, date, unpaid) with paid total and balance; one invoice with
lines, discounts, coverage, ledger, deposit applied and credit notes; the patient's account at the facility (balance
and ledger); a credit note; daily report (with deposits received, applied and refunded, deposits and credit held,
credit notes issued); the patient's own invoices and accounts (MyHealth).

## Events

`ChargeCaptured`, `InvoiceIssued`, `InvoiceVoided`, `ClaimStatusChanged`, `PaymentCompleted`, `RefundIssued`,
`DepositReceived`, `DepositApplied`, `DepositRefunded`, `CreditNoteIssued` (ids, amounts and statuses only). Consumed: `EncounterCompleted`, `LaboratoryOrderCreated`, `LaboratoryOrderCancelled`.

## Permissions

`billing.charge.read`, `billing.charge.capture`, `billing.invoice.issue`, `billing.invoice.void`,
`billing.payment.record`, `billing.refund.issue`, `billing.discount.apply`, `billing.pricelist.manage`,
`billing.report.read`, `billing.deposit.record` (record deposits, apply deposit or credit), `billing.credit-note.issue`
(migration 0035). Refunds of deposit or credit use `billing.refund.issue`. New role **cashier**: read, capture, issue,
payments, deposits, discounts, reports (not void, refund, credit notes or price list). Receptionists can read. Organization administrators hold all. Charges, invoices, payments and reports
require facility context (`X-Facility-Id`).

## API

`/billing/services` (+ `:id`, `:id/prices`), `/billing/payers`, `/billing/discount-rules` (+ `:id/deactivate`),
`/billing/settings`, `/billing/worklist`, `/billing/charges` (+ `:id/cancel`), `/billing/invoices` (+ `:id`,
`:id/items/:itemId`, `:id/discounts[/:discountId]`, `:id/payers[/:invoicePayerId[/status]]`, `:id/discard`,
`:id/issue`, `:id/void`, `:id/payments`, `:id/deposit-applications`, `:id/credit-notes`), `/billing/payments/:id/refund`,
`/billing/patients/:patientId/account` (+ `deposits`, `account-refunds`), `/billing/account-entries/:id/receipt.pdf`,
`/billing/credit-notes/:id` (+ `/pdf`), `/billing/reports/daily?date=`. Patient: `GET /portal/billing` (issued and void
invoices with deposit applied and credit notes; no drafts, notes, staff or evidence), `GET /portal/billing/account`
(balance and ledger per facility; no staff, references or refund reasons),
`GET /portal/billing/credit-notes/:id/pdf`. Every read of patient billing is
audited; patient reads as actor type `patient`.

## Database relationships

Migrations `0019_billing.sql` and `0035_billing_deposits_credit_notes.sql`. Patient and facility references use `(organization_id, id)` keys; clinical sources are
referenced by type and id only (no foreign keys into clinical tables). Triggers: issued invoices immutable (void only),
lines of issued invoices immutable, payments, credit notes and account entries append-only, credit notes only on
issued invoices, account entries of the invoice's patient and facility and never below a zero balance.

## Integration points

- `BillingSources` port (`apps/api/src/app/adapters/billing-adapters.ts`) over `ClinicQueries.billableEncounter` and
  `LabOrderService.billableOrder`; `BillingPatientDirectory` for minimal patient identification in lists.
- `InvoiceService` (exported) serves MyHealth billing.

## Screens

Staff (`billing.charge.read`, facility selected): `/billing` — the cashier's desk (patients with charges to invoice,
drafts, balances owed); `/billing/patients/[id]` — pending charges (tick what to invoice, add a charge at the listed or
another price with a reason, cancel with a reason) and the patient's invoices (also linked from the patient record);
`/billing/invoices` — by day, drafts, balance owed, issued, void; the patient's billing page also shows the deposit and
credit balance with its ledger, records a deposit (receipt printable) and refunds unapplied balance with a reason; `/billing/invoices/[id]` — the invoice workspace:
lines, discounts (evidence ID entered, shown masked), HMO/PhilHealth coverage with LOA reference, totals, issue or
discard; once issued: payments (idempotency key per payment), refunds, claim follow-up (submitted / settled / denied),
void with reason and optional reissue; apply deposit or credit (up to the lesser of the balances); credit notes
(amount per line, up to what is left of it, with a reason; printable); `/billing/reports` — the daily report; `/billing/settings` — services and prices
(charged automatically for a visit type or laboratory test, or only by staff), discount rules (with the statutory
compliance warning), payers, document prefixes (invoice, receipt, credit note). MyHealth: `/billing` ("Bills" on the home screen) — issued and void
invoices with lines, discounts, coverage, payments, deposit applied, credit notes (PDF) and balance, and the deposit
and credit balance per facility with its history (read only); paying online is not available.

## Printable documents

Invoices (drafts watermarked, voids marked; deposit applied and credit notes listed), acknowledgement receipts of
payments and of deposits, and credit notes as PDFs (`BillingDocuments`), for staff and — issued invoices and credit
notes only — the patient in MyHealth. See [printable-documents.md](../architecture/printable-documents.md).

## Compliance dependencies / assumptions

- **BIR:** invoice, receipt and credit note format, numbering, and whether the acknowledgement receipt (of a payment or
  a deposit) may serve as an official receipt must be validated; prefixes and series are configuration. How a credit
  note adjusts VAT or output tax, whether deposits are taxable when received, and whether debit notes are required are
  not encoded. VAT is not computed (amounts are as priced);
  VAT treatment of medical services and of statutory discounts must be confirmed and configured before production.
- **Statutory discounts (RA 9994, RA 10754):** rates, covered services, VAT exemption and combination rules are
  configuration to be verified against current issuances. Nothing is hard-coded; no rule is seeded.
- **PhilHealth:** coverage amounts and claim references are recorded manually; eClaims is an integration dependency. Claims can be prepared and checked from an issued invoice (`docs/interoperability/philhealth-eclaims.md`); an eClaims adapter, once one exists, marks the coverage line submitted through `recordIntegrationClaimSubmitted`.
- **Payment provider** (cards/e-wallets online): an integration dependency; MyHealth shows balances only.
