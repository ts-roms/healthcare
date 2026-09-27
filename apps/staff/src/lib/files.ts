/**
 * Printable documents the staff app serves at /files/... and the API path
 * each comes from. Only these paths are passed through.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ROUTES: Array<[RegExp, (id: string) => string]> = [
  [new RegExp(`^lab-reports/(${UUID})$`, "i"), (id) => `/laboratory/orders/${id}/report.pdf`],
  [new RegExp(`^invoices/(${UUID})$`, "i"), (id) => `/billing/invoices/${id}/pdf`],
  [new RegExp(`^receipts/(${UUID})$`, "i"), (id) => `/billing/payments/${id}/receipt.pdf`],
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
};
