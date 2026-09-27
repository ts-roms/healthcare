import type { TelemedicineSessionSummary, TelemedicineStatus } from "./api/types";

/** Where the patient is in the online consultation, as a label (always with an icon in the UI). */
export function sessionLabel(session: Pick<TelemedicineSessionSummary, "status" | "questionnaireSubmittedAt">): string {
  const labels: Record<TelemedicineStatus, string> = {
    scheduled: session.questionnaireSubmittedAt ? "Questions answered" : "Not answered yet",
    waiting: "In the waiting room",
    in_consultation: "In consultation",
    ended: "Ended",
    escalated: "Escalated to in-person",
  };
  return labels[session.status];
}

/** Minutes the patient has been waiting, or null. */
export function waitingMinutes(session: Pick<TelemedicineSessionSummary, "status" | "patientJoinedAt">, now: Date): number | null {
  if (session.status !== "waiting" || !session.patientJoinedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(session.patientJoinedAt).getTime()) / 60_000));
}

/** Waiting patients first (longest wait first), then by start time. */
export function consultationOrder<T extends { appointment: { startsAt: string }; session: Pick<TelemedicineSessionSummary, "status" | "patientJoinedAt"> }>(
  rows: T[],
): T[] {
  const rank = (r: T) => (r.session.status === "waiting" ? 0 : r.session.status === "in_consultation" ? 1 : r.session.status === "scheduled" ? 2 : 3);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.session.status === "waiting" ? new Date(a.session.patientJoinedAt ?? 0).getTime() - new Date(b.session.patientJoinedAt ?? 0).getTime() : 0) ||
      new Date(a.appointment.startsAt).getTime() - new Date(b.appointment.startsAt).getTime(),
  );
}
