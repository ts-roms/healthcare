/** Documents MyHealth serves at /files/... and the API path each comes from. Only these are passed through. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ROUTES: Array<[RegExp, (id: string) => string]> = [
  [new RegExp(`^lab-reports/(${UUID})$`, "i"), (id) => `/portal/results/orders/${id}/report.pdf`],
  [new RegExp(`^invoices/(${UUID})$`, "i"), (id) => `/portal/billing/${id}/pdf`],
];

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
};
