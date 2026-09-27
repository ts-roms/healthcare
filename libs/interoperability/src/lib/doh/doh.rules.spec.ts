import { buildCasePackage, canApply, caseReadiness, type DohCaseSource, isIcd10, matchRule, normalizeCode } from "./doh.rules";
import { UnconfiguredDohReportingGateway } from "./gateway";

const rule = (codePrefix: string, status = "active") => ({ id: codePrefix, codePrefix, status, category: `Category ${codePrefix}` });

const source = (overrides: Partial<DohCaseSource["diagnosis"]> = {}, address: DohCaseSource["patient"]["address"] = null): DohCaseSource => ({
  diagnosis: {
    id: "dx-1",
    encounterId: "enc-1",
    codeSystemKey: "icd-10",
    code: "a91",
    display: "Dengue haemorrhagic fever",
    certainty: "provisional",
    status: "active",
    recordedAt: "2026-09-20T02:00:00.000Z",
    ...overrides,
  },
  encounter: {
    id: "enc-1",
    facilityId: "fac-1",
    facilityName: "Main Clinic",
    startedAt: "2026-09-20T01:30:00.000Z",
    modality: "in_person",
    practitionerName: "Dr. Cruz",
  },
  patient: {
    id: "pat-1",
    patientNumber: "P00000001",
    familyName: "Dela Cruz",
    givenName: "Juan",
    middleName: null,
    suffix: null,
    sex: "male",
    birthDate: "1980-03-04",
    address,
    contactNumber: "+639171234567",
  },
});

describe("DOH case reporting (platform rules only)", () => {
  it("matches the most specific active rule the organization configured", () => {
    const rules = [rule("A9"), rule("A91"), rule("A01.0"), rule("B05", "inactive")];
    expect(normalizeCode(" a91.0 ")).toBe("A91.0");
    expect(matchRule(rules, "a91")?.codePrefix).toBe("A91");
    expect(matchRule(rules, "A91.0")?.codePrefix).toBe("A91");
    expect(matchRule(rules, "A90")?.codePrefix).toBe("A9");
    expect(matchRule(rules, "A01.0")?.codePrefix).toBe("A01.0");
    expect(matchRule(rules, "A01.1")).toBeUndefined();
    expect(matchRule(rules, "B05")).toBeUndefined(); // inactive
    expect(matchRule([], "A91")).toBeUndefined(); // nothing is reportable unless configured
    expect([isIcd10("icd-10"), isIcd10("ICD10"), isIcd10("snomed"), isIcd10(null)]).toEqual([true, true, false, false]);
  });

  it("allows review actions only from open states", () => {
    expect(canApply("submit", "pending_review")).toBe(true);
    expect(canApply("record_external", "failed")).toBe(true);
    expect(canApply("dismiss", "reported")).toBe(false);
    expect(canApply("submit", "queued")).toBe(false);
    expect(canApply("record_external", "dismissed")).toBe(false);
  });

  it("names what the platform is missing, and builds a format-neutral package", () => {
    const failing = (src: DohCaseSource, code: string | null) =>
      caseReadiness(src, code)
        .filter((c) => !c.ok)
        .map((c) => c.code);
    const address = { line1: null, barangay: "Poblacion", cityMunicipality: "Makati City", province: "Metro Manila", region: "NCR" };
    expect(failing(source({}, address), "DOH-000123")).toEqual([]);
    expect(failing(source(), null)).toEqual(["facility_code_missing", "patient_address_missing"]);
    expect(failing(source({ status: "entered_in_error" }, address), "X")).toEqual(["diagnosis_not_valid"]);
    expect(failing(source({ certainty: "refuted" }, address), "X")).toEqual(["diagnosis_not_valid"]);

    const pkg = buildCasePackage({ id: "case-1", category: "Dengue" }, source({}, address), "DOH-000123");
    expect(pkg).toMatchObject({
      model: "platform-case-1",
      caseReportId: "case-1",
      category: "Dengue",
      facility: { facilityCode: "DOH-000123", name: "Main Clinic" },
      diagnosis: { codeSystem: "icd-10", code: "A91", certainty: "provisional" },
      consultation: { clinician: "Dr. Cruz" },
    });
  });

  it("ships an unconfigured gateway that transmits nothing", async () => {
    const gateway = new UnconfiguredDohReportingGateway();
    expect(gateway.specification).toMatchObject({ status: "dependency", specificationVersion: null });
    await expect(gateway.submitCaseReport()).resolves.toEqual({ outcome: "not_configured" });
  });
});
