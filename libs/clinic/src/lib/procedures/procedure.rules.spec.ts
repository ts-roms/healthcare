import {
  consentProblem,
  performedAtProblem,
  procedureText,
  recordingProblem,
  consentTextHash,
  representativeRequired,
  signatureProblem,
  signatureRequestExpiry,
  signatureRequestProblem,
  signerProblem,
  visitRecordingProblem,
} from "./procedure.rules";

describe("clinic procedure rules", () => {
  const started = new Date("2026-09-30T01:00:00Z");
  const now = new Date("2026-09-30T02:00:00Z");

  it("accepts a time during the consultation and refuses one in the future or before it began", () => {
    expect(performedAtProblem(new Date("2026-09-30T01:30:00Z"), started, now)).toBeNull();
    expect(performedAtProblem(new Date("2026-09-30T02:04:00Z"), started, now)).toBeNull();
    expect(performedAtProblem(new Date("2026-09-30T02:30:00Z"), started, now)).toBe("performed_in_future");
    expect(performedAtProblem(new Date("2026-09-30T00:30:00Z"), started, now)).toBe("performed_before_encounter");
  });

  it("records in an in-person consultation; a signed one needs amendment permission and a reason", () => {
    const open = { status: "in_progress" as const, modality: "in_person" };
    expect(recordingProblem(open, { canAmend: false }, undefined)).toBeNull();
    expect(recordingProblem({ ...open, modality: "telemedicine" }, { canAmend: true }, undefined)).toBe("encounter_online");
    expect(recordingProblem({ ...open, status: "entered_in_error" }, { canAmend: true }, "x")).toBe("encounter_entered_in_error");
    const signed = { ...open, status: "completed" as const };
    expect(recordingProblem(signed, { canAmend: false }, "Forgot to record")).toBe("amendment_permission_required");
    expect(recordingProblem(signed, { canAmend: true }, undefined)).toBe("late_entry_reason_required");
    expect(recordingProblem(signed, { canAmend: true }, "Forgot to record")).toBeNull();
  });

  it("describes a procedure with its quantity and site", () => {
    expect(procedureText({ name: "Suture repair", quantity: 2, bodySite: "left forearm" })).toBe("Suture repair × 2 (left forearm)");
    expect(procedureText({ name: "Nebulization", quantity: 1, bodySite: null })).toBe("Nebulization");
  });

  it("records under a queue visit only while it is open, in person, and the catalogue entry allows it", () => {
    const allowed = { allowedOutsideConsultation: true };
    expect(visitRecordingProblem({ status: "waiting", modality: "in_person" }, allowed)).toBeNull();
    expect(visitRecordingProblem({ status: "in_consultation", modality: "in_person" }, allowed)).toBeNull();
    expect(visitRecordingProblem({ status: "completed", modality: "in_person" }, allowed)).toBe("visit_closed");
    expect(visitRecordingProblem({ status: "cancelled", modality: "in_person" }, allowed)).toBe("visit_closed");
    expect(visitRecordingProblem({ status: "waiting", modality: "telemedicine" }, allowed)).toBe("visit_online");
    expect(visitRecordingProblem({ status: "waiting", modality: "in_person" }, { allowedOutsideConsultation: false })).toBe("procedure_requires_consultation");
  });

  it("requires consent when the entry says so, obtained not after the procedure, with a wording when electronic", () => {
    const performed = new Date("2026-09-30T02:00:00Z");
    const given = (over: Partial<{ capturedVia: "paper" | "electronic" | "verbal"; obtainedAt: Date; wordingId: string | null }> = {}) => ({
      capturedVia: "paper" as const,
      obtainedAt: new Date("2026-09-30T01:50:00Z"),
      wordingId: null,
      ...over,
    });
    expect(consentProblem({ consentRequired: false }, null, performed)).toBeNull();
    expect(consentProblem({ consentRequired: true }, null, performed)).toBe("procedure_consent_required");
    expect(consentProblem({ consentRequired: true }, given(), performed)).toBeNull();
    expect(consentProblem({ consentRequired: false }, given({ obtainedAt: new Date("2026-09-30T02:04:00Z") }), performed)).toBeNull();
    expect(consentProblem({ consentRequired: false }, given({ obtainedAt: new Date("2026-09-30T02:30:00Z") }), performed)).toBe("consent_after_procedure");
    expect(consentProblem({ consentRequired: true }, given({ capturedVia: "electronic" }), performed)).toBe("consent_wording_required");
    expect(consentProblem({ consentRequired: true }, given({ capturedVia: "electronic", wordingId: "w1" }), performed)).toBeNull();
    expect(consentProblem({ consentRequired: true }, given({ capturedVia: "verbal" }), performed)).toBeNull();
  });

  it("hashes the text a signer agreed to, changing with any part of it", () => {
    const text = { wordingId: "w1", version: 2, title: "Consent", body: "I agree.", patientNumber: "P1", procedureCode: "SUT" };
    const hash = consentTextHash(text);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(consentTextHash({ ...text })).toBe(hash);
    for (const change of [{ version: 3 }, { body: "I agree!" }, { patientNumber: "P2" }, { procedureCode: "XYZ" }, { wordingId: "w2" }]) {
      expect(consentTextHash({ ...text, ...change })).not.toBe(hash);
    }
  });

  it("accepts a drawn signature with ink and refuses a tap or an oversized drawing", () => {
    const line = [
      [0.1, 0.5],
      [0.6, 0.5],
    ];
    expect(signatureProblem([line])).toBeNull();
    expect(signatureProblem([[[0.5, 0.5]]])).toBe("signature_empty");
    expect(
      signatureProblem([
        [
          [0.5, 0.5],
          [0.52, 0.5],
        ],
      ]),
    ).toBe("signature_empty");
    expect(signatureProblem(Array.from({ length: 65 }, () => line))).toBe("signature_too_large");
    expect(signatureProblem([Array.from({ length: 3001 }, (_, i) => [i / 3001, 0.5])])).toBe("signature_too_large");
  });
});

describe("signing for minors and requests", () => {
  it("asks a representative to sign for a patient under the organization's age", () => {
    expect(representativeRequired(17, 18)).toBe(true);
    expect(representativeRequired(18, 18)).toBe(false);
    expect(representativeRequired(5, null)).toBe(false);
    expect(representativeRequired(15, 16)).toBe(true);
    expect(signerProblem("patient", true)).toBe("minor_requires_representative");
    expect(signerProblem("representative", true)).toBeNull();
    expect(signerProblem("patient", false)).toBeNull();
  });

  it("lets a request be signed only while pending and before it expires", () => {
    const now = new Date("2026-10-21T04:00:00Z");
    const expiresAt = signatureRequestExpiry(now, 14);
    expect(expiresAt.toISOString()).toBe("2026-11-04T04:00:00.000Z");
    expect(signatureRequestProblem({ status: "pending", expiresAt }, now)).toBeNull();
    expect(signatureRequestProblem({ status: "pending", expiresAt }, expiresAt)).toBe("request_expired");
    expect(signatureRequestProblem({ status: "signed", expiresAt }, now)).toBe("request_not_pending");
    expect(signatureRequestProblem({ status: "cancelled", expiresAt }, now)).toBe("request_not_pending");
  });
});
