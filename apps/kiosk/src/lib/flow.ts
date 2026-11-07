import type { RegistrationForm } from "./registration";

export interface KioskAppointment {
  id: string;
  startsAt: string;
  service: string;
  practitioner: string;
  checkIn: "open" | "too_early" | "too_late" | "done";
}

export interface KioskService {
  id: string;
  name: string;
}

export interface KioskTicket {
  ticket: string;
  queueNumber: number;
  facilityName: string;
  issuedAt: string;
  instructions: string;
  /** The queued print job, when this kiosk prints tickets (the screen asks how it went); null when it has no printer. */
  printJobId: string | null;
}

/** What the screen shows after a check-in: the ticket and the service it was issued for (the API never names the patient). */
export interface IssuedTicket extends KioskTicket {
  service: string;
}

export type Step = "welcome" | "type" | "existing" | "appointments" | "services" | "register" | "review" | "ticket" | "submitted" | "locked";

/**
 * Everything the kiosk screen remembers about the person in front of it. It lives in this reducer's state only — never in
 * storage — and `reset` returns it to the empty welcome state, so nothing outlives a session.
 */
export interface FlowState {
  step: Step;
  /** Initials and birth year after identification: the only thing the API says about the patient. */
  patient: { maskedName: string; birthYear: number } | null;
  appointments: KioskAppointment[];
  form: Partial<RegistrationForm> | null;
  ticket: IssuedTicket | null;
  reference: string | null;
}

export const INITIAL_FLOW: FlowState = { step: "welcome", patient: null, appointments: [], form: null, ticket: null, reference: null };

export type FlowAction =
  | { type: "start" }
  | { type: "choose"; kind: "existing" | "new" }
  | { type: "identified"; patient: { maskedName: string; birthYear: number }; appointments: KioskAppointment[] }
  | { type: "other-services" }
  | { type: "review"; form: RegistrationForm }
  | { type: "edit" }
  | { type: "ticket"; ticket: IssuedTicket }
  | { type: "submitted"; reference: string }
  | { type: "locked" }
  | { type: "back" }
  | { type: "reset" };

/** Whether an appointment can be checked in at this moment (the API decides; the screen only reads its answer). */
export const hasOpenAppointment = (appointments: KioskAppointment[]) => appointments.some((a) => a.checkIn === "open");

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "reset":
      return INITIAL_FLOW;
    case "start":
      return { ...INITIAL_FLOW, step: "type" };
    case "choose":
      return { ...state, step: action.kind === "existing" ? "existing" : "register" };
    case "identified":
      // Someone with an appointment today sees it first; anyone else goes straight to the walk-in services.
      return { ...state, patient: action.patient, appointments: action.appointments, step: action.appointments.length > 0 ? "appointments" : "services" };
    case "other-services":
      return state.patient ? { ...state, step: "services" } : state;
    case "review":
      return { ...state, form: action.form, step: "review" };
    case "edit":
      return { ...state, step: "register" };
    case "ticket":
      return { ...state, ticket: action.ticket, step: "ticket", form: null };
    case "submitted":
      // The typed details are dropped as soon as they are sent; only the reference stays on screen.
      return { ...INITIAL_FLOW, step: "submitted", reference: action.reference };
    case "locked":
      return { ...INITIAL_FLOW, step: "locked" };
    case "back":
      return back(state);
  }
}

function back(state: FlowState): FlowState {
  switch (state.step) {
    case "type":
      return INITIAL_FLOW;
    case "existing":
    case "register":
      return { ...state, step: "type" };
    case "review":
      return { ...state, step: "register" };
    case "services":
      return state.appointments.length > 0 ? { ...state, step: "appointments" } : { ...INITIAL_FLOW, step: "type" };
    default:
      return state;
  }
}

/** Steps where a person is in the middle of something, so the idle warning applies. */
export const isIdleSensitive = (step: Step) => step !== "welcome";
