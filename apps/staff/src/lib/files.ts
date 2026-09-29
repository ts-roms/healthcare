/**
 * Printable documents (reports, invoices, receipts, specimen labels, archived
 * laboratory reports, dental fee estimates, medical certificates) the staff app serves at /files/... and the API path
 * each comes from. Only these paths are passed through.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ROUTES: Array<[RegExp, (id: string) => string]> = [
  [new RegExp(`^lab-reports/(${UUID})$`, "i"), (id) => `/laboratory/orders/${id}/report.pdf`],
  [new RegExp(`^invoices/(${UUID})$`, "i"), (id) => `/billing/invoices/${id}/pdf`],
  [new RegExp(`^receipts/(${UUID})$`, "i"), (id) => `/billing/payments/${id}/receipt.pdf`],
  [new RegExp(`^specimen-labels/(${UUID})$`, "i"), (id) => `/laboratory/specimens/${id}/label.pdf`],
  [new RegExp(`^lab-report-archive/(${UUID})$`, "i"), (id) => `/laboratory/report-archive/${id}/report.pdf`],
  [new RegExp(`^deposit-receipts/(${UUID})$`, "i"), (id) => `/billing/account-entries/${id}/receipt.pdf`],
  [new RegExp(`^credit-notes/(${UUID})$`, "i"), (id) => `/billing/credit-notes/${id}/pdf`],
  [new RegExp(`^debit-notes/(${UUID})$`, "i"), (id) => `/billing/debit-notes/${id}/pdf`],
  [new RegExp(`^send-out-manifests/(${UUID})$`, "i"), (id) => `/laboratory/send-out-dispatches/${id}/manifest.pdf`],
  [new RegExp(`^dental-estimates/(${UUID})$`, "i"), (id) => `/dental/treatment-plans/${id}/estimate.pdf`],
  [new RegExp(`^medical-certificates/(${UUID})$`, "i"), (id) => `/medical-certificates/${id}/certificate.pdf`],
];

/** The API path for a /files/... path, or null when it is not a known document. */
export function fileApiPath(segments: string[]): string | null {
  const path = segments.join("/");
  for (const [pattern, api] of ROUTES) {
    const match = pattern.exec(path);
    if (match?.[1]) return api(match[1]);
  }
  return null;
}

export const fileHref = {
  labReport: (orderId: string) => `/files/lab-reports/${orderId}`,
  invoice: (invoiceId: string) => `/files/invoices/${invoiceId}`,
  receipt: (paymentId: string) => `/files/receipts/${paymentId}`,
  specimenLabel: (specimenId: string) => `/files/specimen-labels/${specimenId}`,
  archivedLabReport: (archiveId: string) => `/files/lab-report-archive/${archiveId}`,
  depositReceipt: (entryId: string) => `/files/deposit-receipts/${entryId}`,
  creditNote: (creditNoteId: string) => `/files/credit-notes/${creditNoteId}`,
  debitNote: (debitNoteId: string) => `/files/debit-notes/${debitNoteId}`,
  sendOutManifest: (dispatchId: string) => `/files/send-out-manifests/${dispatchId}`,
  dentalEstimate: (planId: string) => `/files/dental-estimates/${planId}`,
  medicalCertificate: (certificateId: string) => `/files/medical-certificates/${certificateId}`,
};
