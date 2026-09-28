import { UnconfiguredReferenceLabGateway } from "./gateway";
import { buildSendOutPackage, sendOutIsReady, type ReferenceLabDispatchSource, sendOutReadiness } from "./send-out-package";

const patient = {
  id: "p-1",
  patientNumber: "P-000001",
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: "Santos",
  sex: "male",
  birthDate: "1980-03-04",
};

function source(overrides: Partial<ReferenceLabDispatchSource> = {}): ReferenceLabDispatchSource {
  return {
    dispatch: { id: "d-1", manifestNumber: "SM00000001", dispatchedAt: "2026-09-28T01:00:00.000Z", courier: "Rider", courierReference: "WB-1" },
    sendingFacility: { id: "f-1", name: "Main Clinic" },
    referenceLaboratory: { id: "r-1", code: "ref", name: "Reference Lab", accreditationReference: "LIC-1" },
    specimens: [
      {
        accessionNumber: "2609280001",
        specimenType: "Serum",
        container: "Red-top tube",
        collectedAt: "2026-09-28T00:00:00.000Z",
        orderNumber: "LO00000001",
        priority: "routine",
        fastingRequired: false,
        clinicalIndication: "Screening",
        requestingPhysician: "Dr. Santos",
        patient,
        tests: [{ sendOutId: "s-1", code: "tsh", name: "TSH", loincCode: "3016-3" }],
      },
    ],
    ...overrides,
  };
}

describe("reference laboratory send-out package", () => {
  it("is format-neutral: the platform's own fields, no internal patient id", () => {
    const pkg = buildSendOutPackage(source());
    expect(pkg).toMatchObject({
      manifestNumber: "SM00000001",
      courier: { name: "Rider", reference: "WB-1" },
      referenceLaboratory: { code: "ref", name: "Reference Lab" },
      specimens: [{ accessionNumber: "2609280001", patient: { patientNumber: "P-000001" }, tests: [{ code: "tsh", loincCode: "3016-3" }] }],
    });
    expect(pkg.specimens[0]!.patient).not.toHaveProperty("id");
  });

  it("checks only the platform's own data", () => {
    expect(sendOutIsReady(sendOutReadiness(source()))).toBe(true);
    const empty = source({ specimens: [{ ...source().specimens[0]!, tests: [] }] });
    expect(sendOutReadiness(empty).find((c) => c.key === "specimens")?.ok).toBe(false);
    expect(buildSendOutPackage(empty).specimens).toHaveLength(0);
    const unknown = source({ specimens: [{ ...source().specimens[0]!, patient: null }] });
    expect(sendOutReadiness(unknown).find((c) => c.key === "patients")?.ok).toBe(false);
  });

  it("transmits nothing while no reference laboratory interface is specified", async () => {
    const gateway = new UnconfiguredReferenceLabGateway();
    expect(gateway.specification.status).toBe("dependency");
    await expect(gateway.submitSendOut()).resolves.toEqual({ outcome: "not_configured" });
  });
});
