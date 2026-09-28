# Printable documents (PDF)

Laboratory result reports, specimen tube labels, invoices, payment and deposit receipts and credit notes are PDFs rendered by the API from the
platform's own records. Released laboratory reports are also archived in object storage.

| Document                | Staff (API)                                       | Patient (MyHealth API)                           | Rules                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Laboratory report       | `GET /laboratory/orders/:id/report.pdf`           | `GET /portal/results/orders/:orderId/report.pdf` | Released results only; corrections marked with the reason; signatories (verified/approved by); attached files listed by name (staff and archived copies). Patient's copy: only results the patient may see, no staff names, tests withheld from the patient never named. |
| Invoice                 | `GET /billing/invoices/:id/pdf`                   | `GET /portal/billing/:invoiceId/pdf`             | Drafts watermarked DRAFT (staff only), void invoices VOID. Eligibility ID masked. "Not an official receipt".                                                                                                                                                             |
| Acknowledgement receipt | `GET /billing/payments/:id/receipt.pdf`           | —                                                | Payments only; amount in words; balance right after the payment. "Not an official receipt".                                                                                                                                                                              |
| Specimen tube label     | `GET /laboratory/specimens/:id/label.pdf?copies=` | —                                                | 2.25 × 1.25 in, one label per page; Code 128 barcode of the accession number; name, patient number, sex/age, specimen type, STAT, collection time, test codes — nothing else. `lab.specimen.collect`.                                                                    |
| Archived lab report     | `GET /laboratory/report-archive/:id/report.pdf`   | —                                                | The stored copy, byte for byte, of the report as a release left it ("Archived copy, version N"); listed per patient at `GET /laboratory/patients/:patientId/report-archive`.                                                                                             |
| Deposit receipt         | `GET /billing/account-entries/:id/receipt.pdf`    | —                                                | Deposits only; amount in words; deposit and credit balance right after the deposit. "Not an official receipt".                                                                                                                                                           |
| Credit note             | `GET /billing/credit-notes/:id/pdf`               | `GET /portal/billing/credit-notes/:id/pdf`       | Number, invoice, reason, credited lines, what was taken off the balance and what went to the patient's account; amount in words. BIR conformity subject to confirmation.                                                                                                 |

Every download is audited (`lab.report.print`, `lab.specimen.label-print`, `lab.report.archive.download` with
`document.download`, `billing.invoice.print`, `billing.receipt.print`, `billing.deposit-receipt.print`, `billing.credit-note.print`; patient
downloads `portal.lab-report-download`, `portal.invoice-download`, `portal.credit-note-download` with actor type
`patient`).

## How

- `libs/pdf` (`scope:shared`, `type:util`): a small toolkit over **pdfkit** — A4, the facility's letterhead
  (`facilityLetterhead`), title, label/value fields, tables that break across pages with the header repeated, totals,
  signature lines, watermark, footer with "Printed …" and page numbers. It uses the PDF standard fonts, so no font files
  are shipped: text is reduced to their WinAnsi character set (`winAnsi`; Filipino names with ñ are fine) and amounts are
  written "PHP 1,234.50" (the standard fonts have no ₱). `extractPdfText` reads the text back for tests.
- The laboratory (`LabReportService`) and billing (`BillingDocuments`) libraries lay out their own documents from their
  own data; `pdfFile` (`libs/core`) returns them inline with a file name.
- Labels: `renderLabels` (`label.ts`) draws one label per page at the label stock's size, and `code128Modules`
  (`barcode.ts`) encodes Code 128 (set C for all-digit accession numbers, set B otherwise) as bars drawn with pdfkit —
  no barcode dependency. The unit tests check the symbol table's structure and check digits; the rendered labels were
  also read back with an independent decoder (ZXing) at 203 and 300 dpi.
- The web apps never hold tokens in the browser: `/files/...` route handlers in the staff app
  (`lab-reports/:orderId`, `invoices/:id`, `receipts/:paymentId`, `specimen-labels/:specimenId`,
  `lab-report-archive/:archiveId`, `deposit-receipts/:entryId`, `credit-notes/:id`) and MyHealth (`lab-reports/:orderId`,
  `invoices/:id`, `credit-notes/:id`)
  fetch the PDF from the API with the user's session and stream it back. Only those paths are passed through
  (`lib/files.ts`).
- pdfkit is loaded from `node_modules` at runtime, not bundled (`ExternalsPlugin` in `apps/api/webpack.config.js`): it
  resolves its fonts through a wildcard package import webpack cannot follow.

## Why on request, not a background job

Documents are rendered synchronously on request (tens of milliseconds for a page or two) from records that do not
change once final — released results are immutable versions and issued invoices and payments are immutable — so the
same document can be regenerated at any time and nothing needs to be stored. CLAUDE.md prefers BullMQ for PDF
generation; that remains the plan for heavy or bulk documents (batch statements, long reports).

## Archived laboratory reports (background, object storage)

A copy of each released laboratory report is kept as it was released, in private object storage:

1. The release transaction records `LaboratoryReportReleased` (order id and the released result version ids) in the
   outbox — one event per transaction, so "release all" is one report.
2. The outbox handler `LabReportArchive.schedule` records a `lab_report_archive` row (unique per order and SHA-256 of
   the sorted result ids, so a redelivered event adds nothing; `archive_version` 1, 2, … per order) and puts a job on the
   BullMQ queue `lab-report-archive` (job id = archive id).
3. The consumer (`LabReportArchiveWorker`, in the API process; concurrency 2, 5 attempts with exponential backoff)
   renders the staff copy for exactly those result versions and calls `DocumentsService.storeGenerated`: the object is
   written with a conditional put (`If-None-Match: *`) under `org/<organization>/documents/<archive id>` — an existing
   object is never replaced — and the `document` row (category `laboratory_report`, source `generated`, no uploading
   user) and the archive's `stored` status commit in one transaction. A retry reuses what an earlier attempt stored.
4. Pending archives whose job was lost or ran out of retries are re-queued every 5 minutes (after 10 minutes without
   progress); after 8 attempts in all an archive is `failed`.

A correction released later is a new result set, so a new archived version; earlier versions stay readable (a trigger
refuses changes to a stored archive and deletions). Staff list and open archived reports from the patient record. The
patient's MyHealth copy is still rendered on request (it applies the patient's visibility rules); archived copies are
the staff copy and are not offered to patients.

The FHIR interface exports each stored version as a `DocumentReference` of the order's `DiagnosticReport` (LOINC
`11502-2`); earlier versions are `superseded` and each later one `replaces` the previous
(docs/interoperability/fhir.md). Its content is served through `Binary/{id}` (`document.read`, audited).

## Compliance dependencies

Whether the invoice, the acknowledgement receipt (of a payment or a deposit) or the credit note satisfies BIR requirements (and what an official receipt must
contain), and what a laboratory report must show under DOH licensing rules (e.g. signatories' license numbers), must be
confirmed before production use. The documents state what they are not.
