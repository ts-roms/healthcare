import { DUPLICATE_INVOICE_RULE, duplicateInvoiceSuggestions } from "./duplicate-invoice.rules";

describe("billing.possible-duplicate-invoice", () => {
  const pair = {
    first: { id: "a", number: "INV-000101", issuedAt: "2026-11-20T02:00:00Z" },
    second: { id: "b", number: "INV-000102", issuedAt: "2026-11-20T05:30:00Z" },
    netTotal: 150_000,
    services: 2,
  };

  it("names the two invoices, never the patient, and links to the later one", () => {
    const [s] = duplicateInvoiceSuggestions([pair], "Asia/Manila");
    expect(s).toMatchObject({ ruleId: "billing.possible-duplicate-invoice", severity: "advice", action: { href: "/billing/invoices/b" } });
    expect(s!.title).toBe("Invoices INV-000101 and INV-000102 may be the same visit billed twice");
    expect(s!.rationale).toContain("same total (₱1,500.00) and the same 2 services, issued 4 hours apart");
    expect(s!.id).toBe("billing.possible-duplicate-invoice@1:pair:a:b");
    // Shown in the facility's time.
    expect(s!.evidence.map((e) => e.value)).toEqual(["issued 2026-11-20 10:00", "issued 2026-11-20 13:30", "₱1,500.00"]);
  });

  it("says less than an hour for close pairs", () => {
    expect(duplicateInvoiceSuggestions([{ ...pair, second: { ...pair.second, issuedAt: "2026-11-20T02:20:00Z" } }], "Asia/Manila")[0]!.rationale).toContain(
      "less than an hour apart",
    );
  });

  it("accepts its default parameters", () => {
    expect(DUPLICATE_INVOICE_RULE.parametersSchema.safeParse(DUPLICATE_INVOICE_RULE.defaultParameters).success).toBe(true);
  });
});
