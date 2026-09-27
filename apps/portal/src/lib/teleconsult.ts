import type { PortalTeleconsult } from "./api/types";

/**
 * The patient's side of an online consultation, step by step. The API
 * enforces every rule (questionnaire first, waiting-room window, video only
 * once the doctor starts); this only decides what to show.
 */
export type ConsultStage = "questionnaire" | "early" | "ready" | "waiting" | "in_call" | "ended" | "escalated" | "closed";

export function consultStage(c: PortalTeleconsult, now: Date): ConsultStage {
  if (c.status === "escalated") return "escalated";
  if (c.status === "ended") return "ended";
  if (c.status === "in_consultation") return "in_call";
  if (c.status === "waiting") return "waiting";
  if (["cancelled", "no_show", "completed"].includes(c.appointmentStatus)) return "closed";
  if (!c.questionnaireSubmitted) return "questionnaire";
  if (now > new Date(c.endsAt)) return "closed";
  return now >= new Date(c.waitingRoomOpensAt) ? "ready" : "early";
}

/** Mirrors libs/telemedicine RED_FLAGS (the API validates the keys). */
export const RED_FLAGS: Array<{ key: string; label: string }> = [
  { key: "chest_pain", label: "Chest pain or pressure" },
  { key: "difficulty_breathing", label: "Difficulty breathing or shortness of breath" },
  { key: "severe_bleeding", label: "Heavy bleeding that does not stop" },
  { key: "fainting", label: "Fainting, confusion or trouble staying awake" },
  { key: "stroke_signs", label: "Sudden weakness, numbness, face drooping or trouble speaking" },
  { key: "seizure", label: "A seizure" },
  { key: "severe_pain", label: "Sudden severe pain" },
  { key: "pregnancy_bleeding", label: "Pregnant with bleeding, severe pain or reduced baby movements" },
  { key: "self_harm", label: "Thoughts of harming yourself" },
];

export interface QuestionnaireForm {
  reasonForVisit: string;
  symptoms: string;
  symptomDurationDays: string;
  currentMedications: string;
  newAllergies: string;
  redFlags: string[];
  locationCity: string;
  callbackNumber: string;
  acknowledgesOnlineConsultation: boolean;
}

export const BLANK_QUESTIONNAIRE: QuestionnaireForm = {
  reasonForVisit: "",
  symptoms: "",
  symptomDurationDays: "",
  currentMedications: "",
  newAllergies: "",
  redFlags: [],
  locationCity: "",
  callbackNumber: "",
  acknowledgesOnlineConsultation: false,
};

/** The API payload: empty optional answers are left out. */
export function questionnairePayload(f: QuestionnaireForm) {
  const optional = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    reasonForVisit: f.reasonForVisit.trim(),
    symptoms: optional(f.symptoms),
    symptomDurationDays: f.symptomDurationDays.trim() ? Number(f.symptomDurationDays) : undefined,
    currentMedications: optional(f.currentMedications),
    newAllergies: optional(f.newAllergies),
    redFlags: f.redFlags,
    locationCity: f.locationCity.trim(),
    callbackNumber: f.callbackNumber.trim(),
    acknowledgesOnlineConsultation: f.acknowledgesOnlineConsultation,
  };
}
