import type { SessionTokens } from "@healthcare/web-session";

/** `POST /portal/auth/{activate,login,refresh}` */
export interface PortalTokenResponse extends SessionTokens {
  status: "authenticated";
  tokenType: "Bearer";
}

/** `GET /portal/me`: the signed-in patient's identity (no clinical data). */
export interface PortalMe {
  patient: {
    displayName: string;
    givenName: string;
    familyName: string;
    patientNumber: string;
    birthDate: string;
    sex: string;
  };
  organization: { name: string };
  account: { email: string };
}

/** `GET /portal/appointments` row */
export interface PortalAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "booked" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
  reason: string | null;
  visitType: string;
  modality: "in_person" | "telemedicine";
  practitionerName: string;
  facilityName: string;
  timeZone: string;
  version: number;
  facilityId: string;
  practitionerId: string;
  visitTypeId: string;
  bookedByPatient: boolean;
  /** What the patient may still do in MyHealth (the API enforces the same rules). */
  canCancel: boolean;
  canReschedule: boolean;
}

export interface PortalAppointments {
  upcoming: PortalAppointment[];
  past: PortalAppointment[];
}

export type PortalResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

/** `GET /portal/results` row: a released result the laboratory allows patients to see. */
export interface PortalResult {
  id: string;
  testId: string;
  testName: string;
  orderNumber: string;
  resultType: "numeric" | "text" | "coded";
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: PortalResultFlag | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  collectedAt: string | null;
  releasedAt: string | null;
  corrected: boolean;
}

/** `GET /portal/results/trend?testId=` */
export interface PortalTrend {
  analyte: string;
  testName: string;
  unit: string | null;
  points: PortalResult[];
}

/** `GET /portal/prescriptions` row */
export interface PortalPrescription {
  id: string;
  prescriptionNumber: string;
  issuedAt: string;
  prescriberName: string | null;
  notes: string | null;
  items: Array<{
    genericName: string;
    brandName: string | null;
    strength: string | null;
    dosageForm: string | null;
    doseAmount: number | null;
    doseUnit: string | null;
    route: string;
    frequency: string;
    frequencyText: string | null;
    asNeededReason: string | null;
    durationValue: number | null;
    durationUnit: "days" | "weeks" | "months" | null;
    quantity: number;
    quantityUnit: string;
    refills: number;
    instructions: string;
  }>;
}

/** `GET /portal/care-plans` row */
export interface PortalCarePlan {
  id: string;
  title: string;
  category: string;
  startDate: string;
  goals: Array<{ id: string; description: string; targetMeasure: string | null; targetValue: string | null; targetDate: string | null; status: string }>;
  activities: Array<{ id: string; kind: string; description: string; assignee: "patient" | "care_team"; dueDate: string | null; status: string }>;
}

/** `GET /portal/teleconsults[/:appointmentId]` */
export interface PortalTeleconsult {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  appointmentStatus: string;
  practitionerName: string;
  visitType: string;
  status: "scheduled" | "waiting" | "in_consultation" | "ended" | "escalated";
  questionnaireSubmitted: boolean;
  waitingRoomOpensAt: string;
  videoConfigured: boolean;
  patientInstructions: string | null;
  escalated: boolean;
}

/** `POST /portal/teleconsults/:appointmentId/video` */
export interface VideoJoin {
  url: string;
  token: string;
  room: string;
  expiresInSeconds: number;
}

/** `GET /portal/booking/options`: what the clinic lets patients book online. */
export interface BookingOptions {
  visitTypes: Array<{ id: string; name: string; modality: "in_person" | "telemedicine"; durationMinutes: number }>;
  facilities: Array<{
    id: string;
    name: string;
    cityMunicipality: string | null;
    timeZone: string;
    practitioners: Array<{ id: string; displayName: string; specialty: string | null }>;
  }>;
  rules: { minLeadMinutes: number; maxAdvanceDays: number; maxUpcoming: number; changeCutoffMinutes: number };
}

/** `GET /portal/booking/slots` */
export interface BookingSlots {
  date: string;
  timeZone: string;
  durationMinutes: number;
  slots: Array<{ startsAt: string; endsAt: string; practitionerId: string; practitionerName: string }>;
}

/** The appointment as returned after a booking change. */
export interface BookedAppointment {
  id: string;
  facilityId: string;
  practitionerId: string;
  visitTypeId: string;
  startsAt: string;
  endsAt: string;
  status: PortalAppointment["status"];
  reason: string | null;
  version: number;
}
