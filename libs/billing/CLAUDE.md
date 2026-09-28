# Billing — domain instructions

Extends the root `CLAUDE.md`. Root rules win on conflict.

## Scope

Charge capture, consultation/procedure/laboratory/dental fees, packages, discounts (including statutory Senior Citizen and PWD discounts), HMO, insurance, PhilHealth, invoices, payments, refunds, deposits, receivables, financial reporting.

## Rules

- **Separate from clinical logic.** Billing consumes charge events from clinical domains and never reads or writes their tables. Clinical workflows must not be blocked by billing state unless a facility policy explicitly requires it (e.g. prepaid telemedicine), and that policy is configuration.
- **Money:** currency PHP. Store amounts as `NUMERIC(14,2)` (or integer centavos, chosen once and used everywhere). Never use floating point. Round with an explicit, documented rule.
- **Price lists** are versioned with effective dates; invoice items snapshot the price, discount, and tax applied at the time.
- **Statutory discounts** (e.g. Senior Citizen — RA 9994; PWD — RA 10754) are implemented as configurable, versioned rules with required eligibility evidence (ID number, document reference). Rates, VAT treatment, stacking rules, and covered items must be verified against current official issuances before production — do not hard-code assumptions.
- **HMO / insurance / PhilHealth** coverage is modeled as payer responsibilities on the invoice. PhilHealth claim submission lives in `libs/interoperability` / `libs/philhealth`; billing only records claim references and statuses.
- **Issued invoices are immutable.** Corrections via void + reissue or credit/debit notes, with reason and audit.
- **Payments and refunds** are idempotent (idempotency key per external transaction), recorded as ledger entries, and every refund requires a permission and a reason.
- Payment providers are adapters behind an interface; no provider-specific logic in the billing domain.
- Official receipts / invoicing documents and tax requirements (BIR) must be validated against current rules; treat format and numbering as configuration and an explicit compliance dependency.

## Key events

`ChargeCaptured`, `InvoiceIssued`, `InvoiceVoided`, `PaymentCompleted`, `PaymentFailed`, `RefundIssued`, `ClaimSubmitted`, `ClaimStatusChanged`, `DepositReceived`, `DepositApplied`, `DepositRefunded`, `CreditNoteIssued`, `DebitNoteIssued`.

## Permissions (initial)

`billing.charge.read`, `billing.invoice.issue`, `billing.invoice.void`, `billing.payment.record`, `billing.refund.issue`, `billing.discount.apply`, `billing.pricelist.manage`, `billing.report.read`, `billing.deposit.record`, `billing.credit-note.issue`, `billing.debit-note.issue`.

## Docs

Keep `docs/domains/billing.md` current.
