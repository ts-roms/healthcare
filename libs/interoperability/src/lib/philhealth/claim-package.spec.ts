import { buildClaimPackage, claimReadiness, type ClaimSources, isReady, maskPin, packageDigest } from "./claim-package";
import { UnconfiguredPhilHealthGateway } from "./gateway";

const source = (overrides: Partial<ClaimSources["invoice"]> = {}, pin: string | null = "12-345678901-2"): ClaimSources => ({
  invoice: {
    id: "inv-1",
    invoiceNumber: "INV-00000001",
    status: "issued",
    issuedAt: "2026-09-10T03:00:00.000Z",
    facilityId: "fac-1",
    patientId: "pat-1",
    grossTotal: 150_000,
    discountTotal: 0,
    netTotal: 150_000,
    items: [
      {
        description: "FBS",
        category: "laboratory",
        serviceDate: "2026-09-10",
        quantity: 1,
        grossAmount: 50_000,
        discountAmount: 0,
        netAmount: 50_000,
        sourceType: "lab_order_item",
        sourceId: "li-1",
      },
      {
        description: "Consultation",
        category: "consultation",
        serviceDate: "2026-09-09",
        quantity: 1,
        grossAmount: 100_000,
        discountAmount: 0,
        netAmount: 100_000,
        sourceType: "encounter",
        sourceId: "enc-1",
      },
    ],
    payers: [{ id: "ip-1", payerType: "philhealth", payerName: "PhilHealth", amount: 70_000, reference: null, status: "pending" }],
    ...overrides,
  },
  patient: {
    id: "pat-1",
    patientNumber: "P00000001",
    familyName: "Dela Cruz",
    givenName: "Juan",
    middleName: "Santos",
    suffix: null,
    sex: "male",
    birthDate: "1980-03-04",
    philhealthPin: pin,
  },
  diagnoses: [
    { encounterId: "enc-1", codeSystemKey: "icd-10", code: "I10", display: "Essential hypertension", rank: "secondary", status: "active" },
    { encounterId: "enc-1", codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", rank: "primary", status: "active" },
    { encounterId: "enc-1", codeSystemKey: "icd-10", code: "J06.9", display: "Upper respiratory infection", rank: "secondary", status: "entered_in_error" },
    { encounterId: "enc-1", codeSystemKey: null, code: null, display: "Fatigue", rank: "secondary", status: "active" },
  ],
});
const accreditation = { accreditationNumber: "H12345678", validFrom: "2026-01-01", validUntil: "2026-12-31" };
const failing = (src: ClaimSources, acc: typeof accreditation | null = accreditation) =>
  claimReadiness(src, acc)
    .filter((c) => !c.ok)
    .map((c) => c.code);

describe("PhilHealth claim preparation (platform data only)", () => {
  it("is ready when the platform's own data is complete", () => {
    expect(failing(source())).toEqual([]);
    expect(isReady(claimReadiness(source(), accreditation))).toBe(true);
  });

  it("names what is missing", () => {
    expect(failing(source({ status: "draft" }))).toEqual(["invoice_not_issued"]);
    expect(failing(source({ payers: [] }))).toEqual(["no_philhealth_coverage"]);
    expect(failing(source({}, null))).toEqual(["member_pin_missing"]);
    expect(failing(source(), null)).toEqual(["accreditation_missing"]);
    expect(failing(source(), { ...accreditation, validUntil: "2026-09-09" })).toEqual(["accreditation_not_valid"]);
    const uncoded = source();
    uncoded.diagnoses = uncoded.diagnoses.filter((d) => d.code === null || d.status === "entered_in_error");
    expect(failing(uncoded)).toEqual(["diagnosis_code_missing"]);
  });

  it("builds a format-neutral package: primary diagnosis first, entered-in-error and uncoded left out, service period from the lines", () => {
    const claim = buildClaimPackage(source(), accreditation);
    expect(claim.model).toBe("platform-claim-1");
    expect(claim.diagnoses).toEqual([
      { codeSystem: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", primary: true },
      { codeSystem: "icd-10", code: "I10", display: "Essential hypertension", primary: false },
    ]);
    expect(claim.servicePeriod).toEqual({ from: "2026-09-09", to: "2026-09-10" });
    expect(claim.coverage).toEqual({ invoicePayerId: "ip-1", amountClaimed: 70_000, reference: null });
    expect(claim.facility.accreditationNumber).toBe("H12345678");
  });

  it("digests the package canonically (key order does not matter; content does)", () => {
    const claim = buildClaimPackage(source(), accreditation);
    const reordered = Object.fromEntries(Object.entries(claim).reverse()) as typeof claim;
    expect(packageDigest(reordered)).toBe(packageDigest(claim));
    expect(packageDigest(claim)).toMatch(/^[0-9a-f]{64}$/);
    expect(packageDigest({ ...claim, patient: { ...claim.patient, familyName: "Cruz" } })).not.toBe(packageDigest(claim));
  });

  it("masks the PIN for screens", () => {
    expect(maskPin("12-345678901-2")).toBe("•••• 9012");
    expect(maskPin(null)).toBeNull();
  });

  it("ships an unconfigured gateway that transmits nothing", async () => {
    const gateway = new UnconfiguredPhilHealthGateway();
    expect(gateway.specification).toMatchObject({ status: "dependency", specificationVersion: null });
    await expect(gateway.submitClaim()).resolves.toEqual({ outcome: "not_configured" });
  });
});
