import { describe, expect, it } from "vitest";
import { prescriptionApiQuery, prescriptionLogHref, readPrescriptionFilters } from "./prescription-log";

const P = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";

describe("prescription list filters", () => {
  it("defaults to today and ignores unknown values", () => {
    expect(readPrescriptionFilters({ status: "void", prescriber: "x", number: "12" }, "2026-09-30")).toEqual({
      filters: { from: "2026-09-30", to: "2026-09-30", status: "", prescriber: "", mine: false, number: "", page: 1 },
      adjusted: false,
    });
  });

  it("swaps a reversed period, shortens a long one and upper-cases the number", () => {
    expect(readPrescriptionFilters({ from: "2026-09-30", to: "2026-09-01", number: "rx00000012" }, "2026-09-30").filters).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      number: "RX00000012",
    });
    expect(readPrescriptionFilters({ from: "2026-01-01", to: "2026-09-30" }, "2026-09-30")).toMatchObject({ filters: { from: "2026-07-01" }, adjusted: true });
  });

  it("builds the API query and links; 'only mine' wins over a chosen prescriber", () => {
    const { filters } = readPrescriptionFilters({ from: "2026-09-01", to: "2026-09-30", status: "active", prescriber: P, mine: "1", page: "2" }, "2026-09-30");
    expect(prescriptionApiQuery(filters)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      status: "active",
      prescriberPractitionerId: undefined,
      mine: "true",
      number: undefined,
      page: 2,
      pageSize: 50,
    });
    expect(prescriptionLogHref(filters, 1)).toBe("/clinic/prescriptions?from=2026-09-01&to=2026-09-30&status=active&mine=1");
    expect(prescriptionLogHref({ ...filters, mine: false }, 3)).toBe(
      `/clinic/prescriptions?from=2026-09-01&to=2026-09-30&status=active&prescriber=${P}&page=3`,
    );
  });
});
