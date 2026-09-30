import { describe, expect, it } from "vitest";
import { prescribedLine, prescriptionListHref, prescriptionListQuery, readPrescriptionListFilters } from "./prescription-list";

const TODAY = "2026-09-30";

describe("prescription list filters", () => {
  it("shows today by default", () => {
    expect(readPrescriptionListFilters({}, TODAY)).toEqual({ filters: { from: TODAY, to: TODAY, status: "", mine: false }, adjusted: false });
  });

  it("keeps a valid period, status and 'mine'", () => {
    const { filters } = readPrescriptionListFilters({ from: "2026-09-01", to: "2026-09-15", status: "cancelled", mine: "true" }, TODAY);
    expect(filters).toEqual({ from: "2026-09-01", to: "2026-09-15", status: "cancelled", mine: true });
    expect(prescriptionListQuery(filters)).toEqual({ from: "2026-09-01", to: "2026-09-15", status: "cancelled", mine: "true" });
    expect(prescriptionListHref(filters)).toBe("/clinic/prescriptions?from=2026-09-01&to=2026-09-15&status=cancelled&mine=true");
  });

  it("ignores what the API would refuse, swaps a reversed period and shortens one over 92 days", () => {
    expect(readPrescriptionListFilters({ from: "yesterday", to: "2026-02-30", status: "lost", mine: "yes" }, TODAY).filters).toEqual({
      from: TODAY,
      to: TODAY,
      status: "",
      mine: false,
    });
    expect(readPrescriptionListFilters({ from: "2026-09-20", to: "2026-09-10" }, TODAY).filters).toMatchObject({ from: "2026-09-10", to: "2026-09-20" });
    const long = readPrescriptionListFilters({ from: "2026-01-01", to: "2026-09-30" }, TODAY);
    expect(long).toMatchObject({ filters: { from: "2026-07-01", to: "2026-09-30" }, adjusted: true });
    expect(readPrescriptionListFilters({ from: "2026-07-01", to: "2026-09-30" }, TODAY).adjusted).toBe(false);
  });

  it("uses the first value when a parameter repeats, and leaves out empty filters", () => {
    expect(readPrescriptionListFilters({ status: ["active", "cancelled"] }, TODAY).filters.status).toBe("active");
    expect(prescriptionListQuery({ from: TODAY, to: TODAY, status: "", mine: false })).toEqual({ from: TODAY, to: TODAY });
  });

  it("describes what was prescribed in one line", () => {
    expect(prescribedLine({ genericName: "Amoxicillin", strength: "500 mg", dosageForm: "capsule", quantity: 21, quantityUnit: "capsules" })).toBe(
      "Amoxicillin 500 mg capsule × 21 capsules",
    );
    expect(prescribedLine({ genericName: "Salbutamol", strength: null, dosageForm: null, quantity: 120, quantityUnit: "mL" })).toBe("Salbutamol × 120 mL");
  });
});
