import { describe, expect, it } from "vitest";
import { fileApiPath } from "./files";

const id = "9e121d11-9636-4505-836b-66d13ba58f5e";

describe("file routes", () => {
  it("maps the patient's documents to portal API paths only", () => {
    expect(fileApiPath(["lab-reports", id])).toBe(`/portal/results/orders/${id}/report.pdf`);
    expect(fileApiPath(["invoices", id])).toBe(`/portal/billing/${id}/pdf`);
    expect(fileApiPath(["credit-notes", id])).toBe(`/portal/billing/credit-notes/${id}/pdf`);
    expect(fileApiPath(["debit-notes", id])).toBe(`/portal/billing/debit-notes/${id}/pdf`);
    expect(fileApiPath(["receipts", id])).toBeNull();
    expect(fileApiPath(["invoices", "x"])).toBeNull();
  });
});
