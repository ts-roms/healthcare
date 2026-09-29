import { describe, expect, it } from "vitest";
import type { PatientLabResult, PatientWorkspace, WorkspacePrescription } from "./api/types";
import {
  allergyStatement,
  deriveAlerts,
  diagnosisLine,
  isWithheld,
  maskedPhilHealthPin,
  maskIdentifier,
  nextActivity,
  relevantTests,
  toEncounterHistory,
  toMedications,
  trendFromResults,
  workspaceAccess,
} from "./patient-workspace";

describe("allergy wording on the workspace banner", () => {
  it("never reads a missing review or missing access as 'no allergies'", () => {
    expect(allergyStatement(null)).toEqual({ state: "no_access", text: "Allergies: no access" });
    expect(allergyStatement({ status: "not_reviewed", allergies: [] })).toEqual({ state: "not_recorded", text: "Allergies not recorded — ask the patient" });
    expect(allergyStatement({ status: "no_known_allergies", allergies: [] })).toEqual({ state: "no_known", text: "No known allergies" });
  });

  it("counts recorded allergies, whatever the review status says", () => {
    const allergy = { id: "a1" } as never;
    expect(allergyStatement({ status: "has_allergies", allergies: [allergy] }).text).toBe("1 allergy recorded");
    expect(allergyStatement({ status: "not_reviewed", allergies: [allergy, allergy] })).toEqual({ state: "recorded", text: "2 allergies recorded" });
  });
});

describe("identifier masking", () => {
  it("keeps only the last four digits and the separators", () => {
    expect(maskIdentifier("12-345678901-2")).toBe("••-••••••901-2");
    expect(maskIdentifier("123")).toBe("123");
    expect(
      maskedPhilHealthPin({ identifiers: [{ id: "i", type: "philhealth_pin", value: "12-345678901-2", issuer: null, validFrom: null, validUntil: null }] }),
    ).toBe("••-••••••901-2");
    expect(maskedPhilHealthPin({ identifiers: [] })).toBeNull();
  });
});

describe("panel withholding", () => {
  it("loads a page panel only with every permission it needs", () => {
    expect(workspaceAccess(["patient.read"])).toEqual({ clinical: false, prescriptions: false, carePlans: false, labResults: false, timeline: true });
    expect(workspaceAccess(["patient.read", "clinical.read", "prescription.read", "care-plan.read", "lab.result.read"])).toEqual({
      clinical: true,
      prescriptions: true,
      carePlans: true,
      labResults: true,
      timeline: true,
    });
    expect(workspaceAccess(["clinical.read"]).clinical).toBe(false);
  });

  it("treats a workspace that could not be loaded as withholding every panel", () => {
    expect(isWithheld(null, "lab_orders")).toBe(true);
    expect(isWithheld({ withheld: ["dental_images"] }, "dental_images")).toBe(true);
    expect(isWithheld({ withheld: ["dental_images"] }, "lab_orders")).toBe(false);
  });
});

describe("alerts", () => {
  const critical: NonNullable<PatientWorkspace["criticalResults"]> = [
    { id: "c1", facility: null, status: "open", raisedAt: "2026-09-29T01:00:00Z", orderId: "o1", orderNumber: "LO00000001", testName: "Potassium" },
    { id: "c2", facility: null, status: "communicated", raisedAt: "2026-09-29T02:00:00Z", orderId: "o1", orderNumber: "LO00000001", testName: "Sodium" },
  ];

  it("lists critical results awaiting acknowledgement, chronic problems and consent decisions", () => {
    const alerts = deriveAlerts({
      patient: {
        status: "active",
        consents: [
          { consentType: "portal_access", decision: "granted", recordedAt: "2026-01-01T00:00:00Z" },
          { consentType: "telemedicine", decision: "granted", recordedAt: "2026-01-01T00:00:00Z" },
          { consentType: "telemedicine", decision: "withdrawn", recordedAt: "2026-02-01T00:00:00Z" },
        ] as never,
      },
      problems: [
        { code: "E11.9", display: "Type 2 diabetes mellitus", isChronic: true },
        { code: "J06.9", display: "Acute upper respiratory infection", isChronic: false },
      ],
      criticalResults: critical,
    });
    expect(alerts).toEqual([
      {
        key: "critical:c1",
        tone: "critical",
        text: "Critical result awaiting acknowledgement: Potassium (LO00000001) — not yet communicated",
        href: "/laboratory/critical",
      },
      {
        key: "critical:c2",
        tone: "critical",
        text: "Critical result awaiting acknowledgement: Sodium (LO00000001) — communicated, not yet acknowledged",
        href: "/laboratory/critical",
      },
      { key: "chronic", tone: "info", text: "Chronic: E11.9 Type 2 diabetes mellitus" },
      { key: "consent:telemedicine", tone: "warning", text: "Telemedicine consent withdrawn" },
    ]);
  });

  it("flags an inactive record and a missing portal consent; withheld panels add nothing", () => {
    const alerts = deriveAlerts({ patient: { status: "deceased", consents: [] }, problems: null, criticalResults: null });
    expect(alerts).toEqual([
      { key: "status", tone: "warning", text: "Record status: Deceased" },
      { key: "consent:portal_access", tone: "info", text: "No patient portal (MyHealth) consent" },
    ]);
  });
});

describe("panel mapping", () => {
  it("shows prescriber, number and date with each active medicine", () => {
    const rx = {
      id: "rx1",
      issuedAt: "2026-09-01T02:00:00Z",
      prescriptionNumber: "RX00000001",
      encounterId: "e1",
      prescriberName: "Dr. Reyes",
      items: [
        {
          id: "i1",
          genericName: "Metformin",
          brandName: null,
          strength: "500 mg",
          dosageForm: "tablet",
          frequency: "twice_daily",
          frequencyText: null,
          instructions: "After meals",
        },
      ],
    } satisfies WorkspacePrescription;
    expect(toMedications([rx])).toEqual([
      {
        id: "i1",
        name: "Metformin",
        dose: "500 mg tablet",
        frequency: "twice a day",
        startedOn: "2026-09-01T02:00:00Z",
        prescriber: "Dr. Reyes · RX00000001",
        status: "active",
      },
    ]);
  });

  it("summarizes encounters with their diagnoses", () => {
    const e = {
      id: "e1",
      facility: { id: "f1", name: "Main Clinic" },
      status: "in_progress" as const,
      modality: "in_person",
      appointmentId: null,
      startedAt: "2026-09-29T01:00:00Z",
      completedAt: null,
      practitionerName: "Dr. Reyes",
      visitTypeName: "General consult",
      diagnoses: [
        {
          id: "d1",
          codeSystemKey: "icd-10",
          code: "E11.9",
          display: "Type 2 diabetes mellitus",
          rank: "primary" as const,
          certainty: "confirmed" as const,
          isChronic: true,
          status: "active" as const,
        },
      ],
    };
    expect(diagnosisLine([])).toBe("No diagnosis recorded");
    expect(toEncounterHistory([e])[0]).toMatchObject({
      type: "consultation",
      status: "in-progress",
      provider: "Dr. Reyes",
      facility: "Main Clinic",
      reason: "General consult · E11.9 Type 2 diabetes mellitus",
    });
  });

  it("finds the next due care plan activity and whether it is overdue", () => {
    const plan = {
      openActivities: [
        { id: "a1", kind: "lab_test", description: "HbA1c", dueDate: "2026-10-15", status: "planned" },
        { id: "a2", kind: "follow_up", description: "Follow-up visit", dueDate: "2026-09-20", status: "planned" },
        { id: "a3", kind: "education", description: "Diet counselling", dueDate: null, status: "planned" },
      ],
    };
    expect(nextActivity(plan, "2026-09-29")).toEqual({ description: "Follow-up visit", dueDate: "2026-09-20", overdue: true });
    expect(nextActivity({ openActivities: [] }, "2026-09-29")).toBeNull();
  });
});

describe("laboratory", () => {
  const result = (testId: string, collectedAt: string, extra: Partial<PatientLabResult> = {}) =>
    ({
      id: `${testId}-${collectedAt}`,
      testId,
      testCode: testId,
      testName: testId.toUpperCase(),
      resultType: "numeric",
      valueNumeric: 5,
      valueText: null,
      valueCoded: null,
      unit: "mmol/L",
      flag: "normal",
      critical: false,
      refLow: 3.9,
      refHigh: 5.5,
      refText: null,
      versionNumber: 1,
      collectedAt,
      releasedAt: collectedAt,
      ...extra,
    }) as unknown as PatientLabResult;

  it("puts critical, then abnormal, then trended tests first", () => {
    const results = [
      result("fbs", "2026-09-28T00:00:00Z"),
      result("hba1c", "2026-09-01T00:00:00Z", { flag: "high" }),
      result("k", "2026-08-01T00:00:00Z", { flag: "critical_high", critical: true }),
      result("chol", "2026-09-20T00:00:00Z"),
      result("chol", "2026-03-20T00:00:00Z"),
    ];
    expect(relevantTests(results, 3)).toEqual(["k", "hba1c", "chol"]);
    expect(relevantTests(results, 10)).toEqual(["k", "hba1c", "chol", "fbs"]);
  });

  it("builds a same-test trend oldest first, only with two or more numeric values", () => {
    const results = [result("chol", "2026-09-20T00:00:00Z", { valueNumeric: 6.1 }), result("chol", "2026-03-20T00:00:00Z", { valueNumeric: 5.2 })];
    expect(trendFromResults(results, "chol")?.points.map((p) => p.valueNumeric)).toEqual([5.2, 6.1]);
    expect(trendFromResults(results.slice(0, 1), "chol")).toBeNull();
  });
});
