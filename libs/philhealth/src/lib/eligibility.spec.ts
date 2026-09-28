import type { ClaimSourcePatient } from "./claim-package";
import {
  buildEligibilityInquiry,
  eligibilityReadiness,
  type EligibilityOutcome,
  PhilHealthEligibilityHandler,
  type PhilHealthEligibilityGateway,
  UnconfiguredPhilHealthEligibilityGateway,
} from "./eligibility";

const patient = (pin: string | null = "12-345678901-2"): ClaimSourcePatient => ({
  id: "pat-1",
  patientNumber: "P00000001",
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: null,
  suffix: null,
  sex: "male",
  birthDate: "1980-03-04",
  philhealthPin: pin,
});
const accreditation = { accreditationNumber: "H91000123", validFrom: "2026-01-01", validUntil: "2026-12-31" };
const failing = (...args: Parameters<typeof eligibilityReadiness>) =>
  eligibilityReadiness(...args)
    .filter((c) => !c.ok)
    .map((c) => c.code);

describe("PhilHealth eligibility (platform side only)", () => {
  it("names what the platform is missing before an inquiry", () => {
    expect(failing(patient(), accreditation, "2026-09-27")).toEqual([]);
    expect(failing(patient(null), accreditation, "2026-09-27")).toEqual(["member_pin_missing"]);
    expect(failing(patient(), null, "2026-09-27")).toEqual(["accreditation_missing"]);
    expect(failing(patient(), accreditation, "2027-01-05")).toEqual(["accreditation_not_valid"]);
  });

  it("builds a format-neutral inquiry", () => {
    expect(buildEligibilityInquiry(patient(), "fac-1", accreditation, "2026-09-27")).toEqual({
      model: "platform-eligibility-1",
      patient: patient(),
      facility: { id: "fac-1", accreditationNumber: "H91000123" },
      serviceDate: "2026-09-27",
    });
  });

  it("carries an adapter's answer back as result codes", async () => {
    const answer = (outcome: EligibilityOutcome): PhilHealthEligibilityGateway => ({
      specification: new UnconfiguredPhilHealthEligibilityGateway().specification,
      checkEligibility: () => Promise.resolve(outcome),
    });
    const inquiry = buildEligibilityInquiry(patient(), "fac-1", accreditation, "2026-09-27");
    await expect(
      new PhilHealthEligibilityHandler(answer({ outcome: "answered", answer: "eligible", externalReference: "E-1" })).send(inquiry, "key-12345"),
    ).resolves.toEqual({ outcome: "accepted", externalReference: "E-1", detail: { eligibility: "eligible" } });
    await expect(
      new PhilHealthEligibilityHandler(
        answer({
          outcome: "answered",
          answer: "not_eligible",
          externalReference: "E-2",
          reasons: [
            { code: "R1", message: "x" },
            { code: "R2", message: "y" },
          ],
        }),
      ).send(inquiry, "key-12345"),
    ).resolves.toEqual({ outcome: "accepted", externalReference: "E-2", detail: { eligibility: "not_eligible", reasons: "R1,R2" } });
    await expect(new PhilHealthEligibilityHandler(new UnconfiguredPhilHealthEligibilityGateway()).send(inquiry, "key-12345")).resolves.toEqual({
      outcome: "not_configured",
    });
  });
});
