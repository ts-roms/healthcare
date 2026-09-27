# Printable documents (PDF)

Laboratory result reports, invoices, payment and deposit receipts and credit notes are PDFs rendered by the API from the platform's own records.

| Document                | Staff (API)                                    | Patient (MyHealth API)                           | Rules                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Laboratory report       | `GET /laboratory/orders/:id/report.pdf`        | `GET /portal/results/orders/:orderId/report.pdf` | Released results only; corrections marked with the reason; signatories (verified/approved by). Patient's copy: only results the patient may see, no staff names, tests withheld from the patient never named. |
| Invoice                 | `GET /billing/invoices/:id/pdf`                | `GET /portal/billing/:invoiceId/pdf`             | Drafts watermarked DRAFT (staff only), void invoices VOID. Eligibility ID masked. "Not an official receipt".                                                                                                  |
| Acknowledgement receipt | `GET /billing/payments/:id/receipt.pdf`        | —                                                | Payments only; amount in words; balance right after the payment. "Not an official receipt".                                                                                                                   |
| Deposit receipt         | `GET /billing/account-entries/:id/receipt.pdf` | —                                                | Deposits only; amount in words; deposit and credit balance right after the deposit. "Not an official receipt".                                                                                                |
| Credit note             | `GET /billing/credit-notes/:id/pdf`            | `GET /portal/billing/credit-notes/:id/pdf`       | Number, invoice, reason, credited lines, what was taken off the balance and what went to the patient's account; amount in words. BIR conformity subject to confirmation.                                      |

Every download is audited (`lab.report.print`, `billing.invoice.print`, `billing.receipt.print`,
`billing.deposit-receipt.print`, `billing.credit-note.print`; patient downloads `portal.lab-report-download`,
`portal.invoice-download`, `portal.credit-note-download` with actor type `patient`).

## How

- `libs/pdf` (`scope:shared`, `type:util`): a small toolkit over **pdfkit** — A4, the facility's letterhead
  (`facilityLetterhead`), title, label/value fields, tables that break across pages with the header repeated, totals,
  signature lines, watermark, footer with "Printed …" and page numbers. It uses the PDF standard fonts, so no font files
  are shipped: text is reduced to their WinAnsi character set (`winAnsi`; Filipino names with ñ are fine) and amounts are
  written "PHP 1,234.50" (the standard fonts have no ₱). `extractPdfText` reads the text back for tests.
- The laboratory (`LabReportService`) and billing (`BillingDocuments`) libraries lay out their own documents from their
  own data; `pdfFile` (`libs/core`) returns them inline with a file name.
- The web apps never hold tokens in the browser: `/files/...` route handlers in the staff app
  (`lab-reports/:orderId`, `invoices/:id`, `receipts/:paymentId`, `deposit-receipts/:entryId`, `credit-notes/:id`) and
  MyHealth (`lab-reports/:orderId`, `invoices/:id`, `credit-notes/:id`)
  fetch the PDF from the API with the user's session and stream it back. Only those paths are passed through
  (`lib/files.ts`).
- pdfkit is loaded from `node_modules` at runtime, not bundled (`ExternalsPlugin` in `apps/api/webpack.config.js`): it
  resolves its fonts through a wildcard package import webpack cannot follow.

## Why on request, not a background job

Documents are rendered synchronously on request (tens of milliseconds for a page or two) from records that do not
change once final — released results are immutable versions and issued invoices and payments are immutable — so the
same document can be regenerated at any time and nothing needs to be stored. CLAUDE.md prefers BullMQ for PDF
generation; that remains the plan for heavy or bulk documents (batch statements, long reports) and for keeping an
archived copy of each released laboratory report in object storage, which some facilities may require — a follow-up.

## Compliance dependencies

Whether the invoice, the acknowledgement receipt (of a payment or a deposit) or the credit note satisfies BIR requirements (and what an official receipt must
contain), and what a laboratory report must show under DOH licensing rules (e.g. signatories' license numbers), must be
confirmed before production use. The documents state what they are not.
