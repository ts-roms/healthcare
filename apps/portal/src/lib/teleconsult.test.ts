import { describe, expect, it } from "vitest";
import type { PortalTeleconsult } from "./api/types";
import { BLANK_QUESTIONNAIRE, consultStage, questionnairePayload } from "./teleconsult";

const base: PortalTeleconsult = {
  appointmentId: "a",
  startsAt: "2026-10-01T02:00:00Z",
  timeZone: "Asia/Manila",
  endsAt: "2026-10-01T02:20:00Z",
  appointmentStatus: "booked",
  practitionerName: "Dr. Reyes",
  visitType: "Online consultation",
  status: "scheduled",
  questionnaireSubmitted: false,
  waitingRoomOpensAt: "2026-10-01T01:30:00Z",
  videoConfigured: true,
  patientInstructions: null,
  escalated: false,
};

describe("consultStage", () => {
  const at = (iso: string) => new Date(iso);
  it("asks the questions first", () => {
    expect(consultStage(base, at("2026-10-01T01:45:00Z"))).toBe("questionnaire");
  });
  it("opens the waiting room 30 minutes before", () => {
    const answered = { ...base, questionnaireSubmitted: true };
    expect(consultStage(answered, at("2026-10-01T01:00:00Z"))).toBe("early");
    expect(consultStage(answered, at("2026-10-01T01:30:00Z"))).toBe("ready");
    expect(consultStage(answered, at("2026-10-01T03:00:00Z"))).toBe("closed");
  });
  it("follows the session", () => {
    expect(consultStage({ ...base, status: "waiting" }, at("2026-10-01T02:00:00Z"))).toBe("waiting");
    expect(consultStage({ ...base, status: "in_consultation" }, at("2026-10-01T02:00:00Z"))).toBe("in_call");
    expect(consultStage({ ...base, status: "escalated" }, at("2026-10-01T02:00:00Z"))).toBe("escalated");
    expect(consultStage({ ...base, appointmentStatus: "cancelled" }, at("2026-10-01T02:00:00Z"))).toBe("closed");
  });
});

it("leaves empty optional answers out", () => {
  const payload = questionnairePayload({
    ...BLANK_QUESTIONNAIRE,
    reasonForVisit: " Cough ",
    locationCity: "Makati",
    callbackNumber: "0917 123 4567",
    acknowledgesOnlineConsultation: true,
  });
  expect(payload).toEqual({
    reasonForVisit: "Cough",
    symptoms: undefined,
    symptomDurationDays: undefined,
    currentMedications: undefined,
    newAllergies: undefined,
    redFlags: [],
    locationCity: "Makati",
    callbackNumber: "0917 123 4567",
    acknowledgesOnlineConsultation: true,
  });
});
