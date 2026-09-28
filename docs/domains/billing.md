# Billing (`libs/billing`)

## Purpose

What a patient was charged, what they and their payers owe, and what was paid (CLAUDE.md §18, `libs/billing/CLAUDE.md`):
charge capture from clinical work, packages, invoices with discounts (including statutory Senior Citizen / PWD
discounts) and payer coverage (HMO, PhilHealth, insurers, companies), patient payments and refunds (at the counter or
online through a payment provider port), patient deposits (advance payments) and account credit, credit and debit
notes, the organization's tax and document settings, and a daily report.

Billing is separate from clinical logic: it consumes clinical events, reads clinical facts only through the
`BillingSources` port, and never blocks a clinical workflow. Not in scope yet: PhilHealth eClaims submission (billing
records coverage, references and claim status only), a real payment provider (a port with an unconfigured default),
and anything that would need BIR rules to be encoded (compliance dependencies, below).

## Money

Integer **centavos** (PHP) everywhere: `bigint` columns, integer JSON numbers in the API (`50000` = ₱500.00), never
floating point. Percentages are basis points (`2000` = 20%). Rounding: **half up to the centavo** per line
(`money.ts#percentOf`; VAT inside a VAT-inclusive amount: `billing.rules.ts#vatIncluded`). The database checks every
total (`net = gross − discount`, `patient = net − payer`, line `gross = unit × quantity`, and for a VAT-registered
organization `vatable + VAT + exempt + zero-rated = net`).

## Entities

- `billing_service` — billable service (code, name, category: consultation, procedure, laboratory, dental,
  telemedicine, supply, other), optionally mapped to a clinical source for automatic capture: a **visit type code**
  (charged when an encounter of that visit type is signed) or a **laboratory test code** (charged when ordered). Its
  optional **VAT class** (`vatable`, `vat_exempt`, `zero_rated`) is configuration. A **package** is a service with
  `is_package`, an optional validity in days and its contents in `billing_package_item` (services and quantities,
  fixed once created).
- `billing_service_price` — versioned prices with effective dates (no overlaps: exclusion constraint). Adding a price
  ends the previous one the day before; charges and invoice lines keep the price they used. Packages are priced the
  same way.
- `billing_payer` — HMO, PhilHealth, insurer, company.
- `billing_discount_rule` — rate (basis points), categories it applies to (none = all), `statutory`,
  `requires_evidence` (always for statutory), `stackable`, effective dates. A changed rule is a new row.
- `billing_package_enrollment` — a package sold to a patient at a facility: `active` or `cancelled` (reason), from the
  day of sale to its end date (from the validity). What is left of each included service is derived from its charges.
- `billing_charge` — one billable thing for a patient at a facility: source (`encounter`, `lab_order_item`, `manual`,
  `package` — the sale of a package), price snapshot, service date, status `pending → invoiced` (on a draft or issued
  invoice) or `cancelled` (reason). Unique per clinical source and service, so event redelivery charges once. A charge a
  package covers is at zero and points to the enrollment.
- `billing_invoice` (+ `_item`, `_discount`, `_payer`) — `draft → issued → void`. Numbered on issue
  (`INV-2026-000001`; prefix configurable). **Issued invoices and their lines are immutable** (triggers); only payer
  claim status may change after issue. On issue the invoice takes a **tax snapshot** from the organization's profile
  (seller's registered name, TIN, address, permit reference, document note, VAT status and rate) and, when
  VAT-registered, each line's VAT class and VAT and the invoice's VAT breakdown. A void records the reason and the
  replacement draft.
- `billing_payment` — append-only ledger of patient payments and refunds (method: cash, card, e-wallet, bank transfer,
  check, other; reference; receipt number `AR-2026-000001`), each with a unique idempotency key. A payment completed
  online has no staff user and points to its payment intent.
- `billing_payment_intent` — a payment started online (MyHealth): invoice, amount, provider and its reference,
  checkout address, `pending → succeeded | failed | cancelled | expired` (once), what was collected.
- `billing_sequence` — document number series per organization: `invoice`, `receipt` (payments and deposits),
  `credit_note`, `debit_note`, each with its prefix and, optionally, the last number the organization is authorized to
  use.
- `billing_credit_note` (+ `_line`, `_payer`) — a credit against lines of an issued invoice or of its debit notes:
  number (`CN-2026-000001`), reason, amount, split into `payer_amount` (reduced payers' open coverage, per payer),
  `applied_amount` (reduced what the patient owed) and `account_credit` (already paid; credited to the patient's
  account). Append-only; a trigger allows them on issued invoices only.
- `billing_debit_note` (+ `_line`) — what is added to an issued invoice: number (`DN-2026-000001`), reason, lines (a
  service, or an adjustment described in words; quantity × unit price). Append-only; issued invoices only.
- `billing_account_entry` — the patient's account per facility, an append-only ledger: `deposit` (+, method,
  reference, receipt number, idempotency key), `credit` (+, from a credit note), `application` (−, to an issued
  invoice, idempotency key), `release` (+, an application returned when its invoice is voided), `refund` (−, method,
  reason, idempotency key), `transfer_out` / `transfer_in` (balance moved between two facilities, sharing a transfer
  id). The balance is derived from the ledger; a trigger refuses anything that would take a facility's balance below
  zero.
- `billing_organization_profile` — the organization's own tax and document settings (registered name, TIN, business
  address, VAT status `not_configured | vat_registered | non_vat`, VAT rate, permit reference, document note) and
  whether deposits can be used across its facilities.

## Rules

- **Capture** (`ChargeCapture`, outbox handlers): `EncounterCompleted` → the visit type's service (signed encounters
  only); `LaboratoryOrderCreated` → one charge per non-cancelled item with a mapped test; `LaboratoryOrderCancelled` →
  its pending charges are cancelled (invoiced ones need a void). Unmapped or unpriced sources are not charged and do not
  fail the clinical workflow; staff add a manual charge.
- **Manual charges** use the listed price; another price needs a reason (audited with both prices). A package is sold,
  not added as a charge (`package_sold_separately`).
- **Packages**: selling one (`billing.charge.capture`) records an enrollment and a charge for the package at today's
  price. While the enrollment is active and in its dates, a charge at that facility for an included service — captured
  from clinical work or added by staff (unless staff give another price or opt out) — is covered: charged at zero,
  described "(covered by …)", and counted against what is left; the enrollment ending soonest is used first; a charge
  is covered whole or not at all (`packageCovers`). Cancelling a covered charge gives the unit back. An unused package
  can be cancelled with a reason (its pending sale charge is cancelled with it; an invoiced one is credited on its
  invoice); a used one cannot (`package_in_use`). Contents never change: a changed package is a new one.
- **Drafts** gather a patient's pending charges at the facility (all, or chosen ones); lines can be removed (the charge
  returns to pending); a draft can be discarded. Every change recomputes discounts and totals.
- **Discounts** apply to the lines of their categories, one after another on what remains (`billing.rules.ts`). A rule
  that requires evidence needs the ID number (e.g. OSCA or PWD ID), stored for audit and claims and shown masked
  (`•••• 4512`). Non-stackable discounts are not combined (statutory discounts included, unless configured otherwise
  after verification).
- **Payer coverage** (HMO LOA, PhilHealth, insurer) is an amount per payer with a reference; it cannot exceed the total
  after discounts. The patient owes the rest. After issue, coverage is followed up: `submitted`, `settled` (amount, not
  more than the coverage less credit notes' payer parts) or `denied`.
- **Issue** numbers the invoice. When the organization's profile says VAT-registered, every line's service must have a
  VAT class (`tax_class_required`, nothing issued) and the VAT breakdown is computed from the configured rate
  (`taxBreakdown`, VAT-inclusive prices, half up per line); otherwise no VAT is computed. The seller's details are
  copied from the profile either way. When a series has a last authorized number and it is reached, nothing is issued
  and no number is taken (`number_series_exhausted`).
- **Payments** only on issued invoices, never more than the patient's balance (change is given at the counter); the
  same idempotency key replays the recorded payment, a different transaction with it is refused.
- **Online payment** (MyHealth, offered only when a payment provider adapter is configured): the patient starts a
  payment intent within the balance (idempotent per key; the return address must be one of the platform's origins)
  and pays on the provider's hosted checkout. The provider's notification, verified by the adapter against the raw
  body (`POST /billing/online-payments/notifications`, public), completes the intent once: the collected amount pays
  the balance at that moment and any excess — the invoice was paid at the counter meanwhile — becomes a deposit
  (`onlinePaymentSplit`); both get receipt numbers. A failed, cancelled or expired intent records nothing. Without an
  adapter, starting one is refused (`integration_not_configured`).
- **Refunds** need `billing.refund.issue` and a reason, and never exceed what is left of the payment.
- **Invoice balance** = patient's share + debit notes − (payments − refunds) − (deposit applied − released) − credit
  notes' patient-applied amounts (`billing.rules.ts#invoiceBalance`); it is what payments, online payments and deposit
  applications are checked against, in lists (`unpaid`), the invoice, its PDF and receipts.
- **Deposits** (advance payments) are recorded on the patient's account at the selected facility with a receipt from the
  receipt series; the same idempotency key replays the entry. The balance is applied to issued invoices of that patient
  and facility, partly or fully, never beyond the invoice balance or the usable balance (`applicationProblem`).
  Unapplied balance is refunded with `billing.refund.issue` and a reason, never beyond the usable balance. Changes to a
  patient's accounts are serialized (a transaction-scoped advisory lock per patient, taken after any invoice lock). A
  void returns the deposit applied to the invoice to the account (`release`); payments must still be refunded first.
- **Deposits across facilities** (organization profile, off by default): the usable balance is the patient's balance at
  all the organization's facilities. When the facility's own balance does not cover an application or refund, the
  shortfall is moved from the other facilities, largest balance first (`transferPlan`), as audited
  `transfer_out`/`transfer_in` pairs before the application or refund — so each facility's ledger stays whole and
  non-negative, and daily reports stay per facility.
- **Credit notes** (`billing.credit-note.issue`, reason) correct an issued invoice without voiding it: each line credits
  a line of the invoice or of one of its debit notes, at most its amount less earlier credits (`creditNoteProblem`).
  Part of the total may reduce a payer's coverage while its claim is pending or submitted, never beyond the coverage
  left (`creditAllocationProblem`; a settled or denied claim is a matter for the payer). The rest is the patient's
  part, at most their share plus debit notes less earlier patient credits: it first reduces what the patient still
  owes, and what they already paid becomes account credit (`splitCredit`). Issued at once, numbered, immutable,
  idempotent per key.
- **Debit notes** (`billing.debit-note.issue`, reason) add to an issued invoice: services at their listed price on the
  day (or another given price) or adjustments described in words (`debitNoteProblem`). Issued at once, numbered,
  immutable, idempotent per key; they add to the patient's balance. A mistaken debit note is corrected with a credit
  note on its lines.
- **Void** needs `billing.invoice.void` and a reason, and only when nothing is paid (refund first), no payer has
  settled, and no credit or debit note was issued (`invoice_has_credit_notes`, `invoice_has_debit_notes`: correct with
  another note). By default the charges, discounts (with their evidence) and coverage move to a new draft.

## Commands

Create service / add price / update service (including VAT class); create package; create payer; create or deactivate
discount rule; set number prefixes and last authorized numbers; update the tax profile; add or cancel a charge; sell a
package, cancel an unused one; create draft, remove line, apply or remove discount, set or remove payer coverage,
discard, issue, void; update claim status; record payment; refund; record deposit; apply deposit or credit to an
invoice; refund deposit or credit; issue credit note; issue debit note; start an online payment (patient); complete an
online payment (provider notification).

## Queries

Services with price history and current price; packages with contents; payers; discount rules; settings (series);
tax profile; cashier worklist (patients with pending charges at the facility); charges; invoices (by patient, status,
date, unpaid) with paid total and balance; one invoice with lines, discounts, coverage (with payer credits), ledger,
deposit applied, credit and debit notes, online payments and tax snapshot; the patient's account at the facility
(balance, ledger, and other facilities' balances when shared); the patient's packages; a credit or debit note; daily
report (invoices, discounts, collections, refunds, deposits received/applied/refunded/held, credit notes with payer
parts, debit notes); the patient's own invoices and accounts, and online payment availability and status (MyHealth).

## Events

`ChargeCaptured`, `InvoiceIssued`, `InvoiceVoided`, `ClaimStatusChanged`, `PaymentCompleted` (also for online payments),
`RefundIssued`, `DepositReceived`, `DepositApplied`, `DepositRefunded`, `CreditNoteIssued`, `DebitNoteIssued` (ids,
amounts and statuses only). Consumed: `EncounterCompleted`, `LaboratoryOrderCreated`, `LaboratoryOrderCancelled`.

## Permissions

`billing.charge.read`, `billing.charge.capture` (also sells and cancels packages), `billing.invoice.issue`,
`billing.invoice.void`, `billing.payment.record`, `billing.refund.issue`, `billing.discount.apply`,
`billing.pricelist.manage` (also packages, tax profile, series), `billing.report.read`, `billing.deposit.record`
(record deposits, apply deposit or credit), `billing.credit-note.issue` (migration 0035), `billing.debit-note.issue`
(migration 0036). Refunds of deposit or credit use `billing.refund.issue`. Role **cashier**: read, capture, issue,
payments, deposits, discounts, reports (not void, refund, credit or debit notes, price list). Receptionists can read.
Organization administrators hold all. Charges, invoices, payments and reports require facility context
(`X-Facility-Id`). Patients start online payments through MyHealth (`PatientAccessGuard`); provider notifications are
public and verified by the adapter.

## API

`/billing/services` (+ `:id`, `:id/prices`), `/billing/packages`, `/billing/payers`, `/billing/discount-rules`
(+ `:id/deactivate`), `/billing/settings`, `/billing/tax-profile`, `/billing/worklist`, `/billing/charges`
(+ `:id/cancel`), `/billing/invoices` (+ `:id`, `:id/items/:itemId`, `:id/discounts[/:discountId]`,
`:id/payers[/:invoicePayerId[/status]]`, `:id/discard`, `:id/issue`, `:id/void`, `:id/payments`,
`:id/deposit-applications`, `:id/credit-notes`, `:id/debit-notes`), `/billing/payments/:id/refund`,
`/billing/patients/:patientId/account` (+ `deposits`, `account-refunds`), `/billing/patients/:patientId/packages`,
`/billing/package-enrollments/:id/cancel`, `/billing/account-entries/:id/receipt.pdf`, `/billing/credit-notes/:id`
(+ `/pdf`), `/billing/debit-notes/:id` (+ `/pdf`), `/billing/online-payments/notifications` (provider),
`/billing/reports/daily?date=`. Patient: `GET /portal/billing` (issued and void invoices with deposit applied, credit
and debit notes, online payments; no drafts, notes, staff or evidence), `GET /portal/billing/account` (balance and
ledger per facility; no staff, references or refund reasons), `GET /portal/billing/online-payment` (availability),
`POST /portal/billing/:invoiceId/online-payments`, `GET /portal/billing/online-payments/:id`,
`GET /portal/billing/{credit,debit}-notes/:id/pdf`. Every read of patient billing is audited; patient reads as actor
type `patient`.

## Database relationships

Migrations `0019_billing.sql`, `0035_billing_deposits_credit_notes.sql`, `0036_billing_debit_notes.sql`,
`0037_billing_packages.sql`, `0038_billing_online_payments.sql`, `0039_billing_tax_profile_shared_deposits.sql`.
Patient and facility references use `(organization_id, id)` keys; clinical sources are referenced by type and id only
(no foreign keys into clinical tables). Triggers: issued invoices immutable including their tax snapshot (void only),
lines of issued invoices immutable, payments, credit and debit notes and account entries append-only, notes only on
issued invoices, account entries of the invoice's patient and facility and never below a facility's zero balance,
payment intents complete once.

## Integration points

- `BillingSources` port (`apps/api/src/app/adapters/billing-adapters.ts`) over `ClinicQueries.billableEncounter` and
  `LabOrderService.billableOrder`; `BillingPatientDirectory` for minimal patient identification in lists.
- `PAYMENT_GATEWAY` (`payments/payment-gateway.ts`): `createCheckout` and `verifyNotification`; the default
  `UnconfiguredPaymentGateway` (status `dependency`) takes no payment. An adapter is provided through
  `BillingModule.forRoot({ paymentGateway })` (`AppModuleOverrides.paymentGateway` in tests). The API keeps the raw
  request body for signature checks (`rawBody: true`).
- `InvoiceService`, `DepositService` and `OnlinePaymentService` (exported) serve MyHealth billing.

## Screens

Staff (`billing.charge.read`, facility selected): `/billing` — the cashier's desk; `/billing/patients/[id]` — pending
charges (tick what to invoice, add a charge, cancel with a reason), invoices, packages (what is left, sell, cancel an
unused one), and the deposit and credit balance with its ledger (deposit with printable receipt, refund with a reason;
other facilities' balances when shared); `/billing/invoices` — by day, drafts, balance owed, issued, void;
`/billing/invoices/[id]` — the invoice workspace: lines, discounts (evidence ID entered, shown masked), coverage, totals,
issue or discard; once issued: payments, refunds, online payments, claim follow-up, deposit or credit applied, VAT
breakdown (when VAT-registered), debit notes (services or adjustments), credit notes (per line of the invoice or its
debit notes, optionally part off a payer's open claim), void with reason when no note exists; `/billing/reports` — the
daily report; `/billing/settings` — services and prices with VAT class, packages, discount rules, payers, tax and
document settings (with the BIR warning), document numbers with authorized ranges. MyHealth: `/billing` — issued and
void invoices with lines, discounts, coverage, payments, deposit applied, credit and debit notes (PDF), online payment
status and balance; the deposit and credit balance per facility; **Pay online** when a provider is configured.

## Printable documents

Invoices (drafts watermarked, voids marked; deposit applied, credit and debit notes listed; seller's details, VAT
breakdown and document note from the tax snapshot), acknowledgement receipts of payments and of deposits, credit notes
(with payer parts) and debit notes as PDFs (`BillingDocuments`), for staff and — issued invoices and notes only — the
patient in MyHealth. See [printable-documents.md](../architecture/printable-documents.md).

## Compliance dependencies / assumptions

- **BIR:** nothing about BIR is encoded as a rule. The organization enters its registered name, TIN, address, VAT status
  and rate, permit reference and document text, classifies services for VAT, and sets number prefixes and authorized
  ranges; the platform stores, snapshots and prints them. Still to be validated with the organization's accountant and
  current issuances before production: whether the invoice, acknowledgement receipts, credit and debit notes meet BIR
  requirements (format, required wording, whether an acknowledgement receipt may serve as an official receipt,
  registration of the system), VAT treatment of medical services and of statutory discounts (the discount is computed
  on the VAT-inclusive line; VAT-exempt treatment of discounted sales is not implemented), how credit and debit notes
  adjust output VAT, whether deposits are taxable when received, and VAT-exclusive pricing (not supported).
- **Statutory discounts (RA 9994, RA 10754):** rates, covered services, VAT exemption and combination rules are
  configuration to be verified against current issuances. Nothing is hard-coded; no rule is seeded.
- **PhilHealth:** coverage amounts and claim references are recorded manually; eClaims is an integration dependency.
  Claims can be prepared and checked from an issued invoice (`docs/interoperability/philhealth-eclaims.md`); an eClaims
  adapter, once one exists, marks the coverage line submitted through `recordIntegrationClaimSubmitted`. Claim
  preparation uses the coverage amount on the invoice, not less credit notes' payer parts.
- **Payment provider** (cards, e-wallets, online banking): not chosen — an integration dependency. The port, intents,
  notification handling and MyHealth flow exist; an adapter needs the provider's contract, API and notification
  signature scheme. Pending intents a provider never answers stay pending (no expiry job yet).
- **Packages** are per facility: sold and used at the same facility.
