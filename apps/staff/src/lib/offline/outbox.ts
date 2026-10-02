import type { RegistrationForm } from "../patient-registration";
import type { VitalsPayload } from "../triage-form";

/**
 * The offline outbox (docs/architecture/staff-app.md, "Offline"; ADR-0013): actions captured while the clinic has no
 * connection, replayed in capture order through the same server actions the live screens use, each with its own
 * idempotency key. Nothing here is authoritative: the API validates every replay as if it had been typed live, and
 * whatever it refuses is parked for a person to resolve — never merged or retried blindly.
 */

export type OfflineActionKind = "register" | "walk_in" | "triage";
export type OfflineActionStatus = "waiting" | "replaying" | "done" | "parked";

/** A patient as the offline screen knows them: registered offline (an action id) or an existing patient number. */
export type PatientRef = { kind: "offline"; actionId: string } | { kind: "number"; patientNumber: string };
/** A visit: one on the snapshot (its id), or a walk-in captured offline (an action id). */
export type VisitRef = { kind: "existing"; visitId: string; ticket: string } | { kind: "offline"; actionId: string };

export interface RegisterPayload {
  form: RegistrationForm;
}
export interface WalkInPayload {
  patient: PatientRef;
  visitTypeId: string;
  priority: "routine" | "urgent" | "emergency";
  chiefComplaint?: string;
}
export interface TriagePayload {
  visit: VisitRef;
  chiefComplaint: string;
  priority: "routine" | "urgent" | "emergency";
  vitals: VitalsPayload;
  completeTriage: boolean;
}

export type OfflineAction =
  | {
      id: string;
      kind: "register";
      status: OfflineActionStatus;
      capturedAt: string;
      label: string;
      payload: RegisterPayload;
      result?: { patientId: string; patientNumber: string };
      parked?: Parked;
    }
  | {
      id: string;
      kind: "walk_in";
      status: OfflineActionStatus;
      capturedAt: string;
      label: string;
      payload: WalkInPayload;
      result?: { visitId: string; ticket: string };
      parked?: Parked;
    }
  | {
      id: string;
      kind: "triage";
      status: OfflineActionStatus;
      capturedAt: string;
      label: string;
      payload: TriagePayload;
      result?: { visitId: string };
      parked?: Parked;
    };

export interface Parked {
  code: string;
  message: string;
  /** Possible duplicates the API found for a registration, for the person to review on the live screen. */
  candidates?: Array<{ patientId: string; patientNumber: string; displayName: string; reason: string }>;
}

/** The action this one must wait for (a registration or a walk-in captured offline), if any. */
export function dependencyOf(action: OfflineAction): string | null {
  if (action.kind === "walk_in" && action.payload.patient.kind === "offline") return action.payload.patient.actionId;
  if (action.kind === "triage" && action.payload.visit.kind === "offline") return action.payload.visit.actionId;
  return null;
}

/**
 * The next action to replay: the oldest waiting one whose dependency is done. An action whose dependency was parked
 * is parked too (its target never came to exist), so a refused registration never leaves a walk-in waiting forever.
 */
export function nextReplayable(actions: OfflineAction[]): OfflineAction | null {
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (const action of [...actions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    if (action.status !== "waiting") continue;
    const dependency = dependencyOf(action);
    if (!dependency) return action;
    const target = byId.get(dependency);
    if (target?.status === "done") return action;
  }
  return null;
}

/** Actions waiting on a dependency that was parked: they are parked with the same explanation. */
export function parkOrphans(actions: OfflineAction[]): OfflineAction[] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  return actions.map((action) => {
    if (action.status !== "waiting") return action;
    const dependency = dependencyOf(action);
    const target = dependency ? byId.get(dependency) : undefined;
    if (!dependency || !target) return action;
    if (target.status === "parked") {
      return {
        ...action,
        status: "parked",
        parked: { code: "dependency_parked", message: `Waits on "${target.label}", which could not be replayed.` },
      } as OfflineAction;
    }
    return action;
  });
}

/** How many actions still wait or are parked: what the banner shows. */
export function outboxCounts(actions: OfflineAction[]): { waiting: number; parked: number } {
  return {
    waiting: actions.filter((a) => a.status === "waiting" || a.status === "replaying").length,
    parked: actions.filter((a) => a.status === "parked").length,
  };
}

/** The real patient id behind a reference, once its registration replayed. */
export function resolvePatient(ref: PatientRef, actions: OfflineAction[]): { patientId: string } | { patientNumber: string } | null {
  if (ref.kind === "number") return { patientNumber: ref.patientNumber };
  const target = actions.find((a) => a.id === ref.actionId);
  return target?.kind === "register" && target.result ? { patientId: target.result.patientId } : null;
}

/** The real visit id behind a reference, once its walk-in replayed. */
export function resolveVisit(ref: VisitRef, actions: OfflineAction[]): string | null {
  if (ref.kind === "existing") return ref.visitId;
  const target = actions.find((a) => a.id === ref.actionId);
  return target?.kind === "walk_in" && target.result ? target.result.visitId : null;
}

/** Done actions are kept for the person to see, then dropped once older than this. */
export const DONE_RETENTION_MS = 24 * 60 * 60 * 1000;

export function pruneDone(actions: OfflineAction[], now: Date): OfflineAction[] {
  return actions.filter((a) => a.status !== "done" || now.getTime() - Date.parse(a.capturedAt) < DONE_RETENTION_MS);
}
