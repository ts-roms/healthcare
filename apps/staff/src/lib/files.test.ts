import { describe, expect, it } from "vitest";
import { fileApiPath, fileHref } from "./files";

const id = "9e121d11-9636-4505-836b-66d13ba58f5e";

describe("file routes", () => {
  it("maps known documents to their API path", () => {
    expect(fileApiPath(["lab-reports", id])).toBe(`/laboratory/orders/${id}/report.pdf`);
    expect(fileApiPath(["invoices", id])).toBe(`/billing/invoices/${id}/pdf`);
    expect(fileApiPath(["receipts", id])).toBe(`/billing/payments/${id}/receipt.pdf`);
    expect(fileHref.invoice(id)).toBe(`/files/invoices/${id}`);
  });

  it("passes nothing else through", () => {
    expect(fileApiPath(["invoices", "../patients"])).toBeNull();
    expect(fileApiPath(["patients", id])).toBeNull();
    expect(fileApiPath(["invoices", id, "extra"])).toBeNull();
  });
});
