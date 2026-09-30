import { describe, expect, it } from "vitest";
import { auditApiQuery, auditPageHref, readAuditFilters } from "./audit-filters";

describe("audit log filters", () => {
  it("keeps only well-formed values from the URL", () => {
    const filters = readAuditFilters({
      from: "2026-09-01",
      to: "not-a-date",
      actor: "not-a-uuid",
      patient: "0b8f3c2e-1d4a-4c5b-9e6f-7a8b9c0d1e2f",
      action: "  patient.read  ",
      page: "0",
    });
    expect(filters).toEqual({
      from: "2026-09-01",
      to: "",
      action: "patient.read",
      resourceType: "",
      actor: "",
      patient: "0b8f3c2e-1d4a-4c5b-9e6f-7a8b9c0d1e2f",
      page: 1,
    });
  });

  it("asks the API for whole local days in Manila time", () => {
    const query = auditApiQuery(readAuditFilters({ from: "2026-09-01", to: "2026-09-02", page: "3" }));
    expect(query).toMatchObject({ from: "2026-09-01T00:00:00+08:00", to: "2026-09-02T23:59:59.999+08:00", page: 3, pageSize: 50 });
    expect(query.action).toBeUndefined();
  });

  it("links to other pages of the same search", () => {
    const filters = readAuditFilters({ action: "patient.read", page: "2" });
    expect(auditPageHref(filters, 3)).toBe("/admin/audit?action=patient.read&page=3");
    expect(auditPageHref(filters, 1)).toBe("/admin/audit?action=patient.read");
    expect(auditPageHref(readAuditFilters({}), 1)).toBe("/admin/audit");
  });
});
