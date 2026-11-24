import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `clinic.no-show-risk` (docs/domains/assistant.md): an upcoming appointment whose patient missed a large share of
 * their past appointments. The pattern is the patient's own history at this organization, nothing else: no age, sex,
 * place or diagnosis. It suggests a call to confirm, or keeping the waiting list in mind; nothing is cancelled or
 * double-booked. The suggestion names the time, never the patient (the board shows who it is).
 */

export const noShowRiskParameters = z.object({
  /** How far back the patient's past appointments are counted. */
  historyDays: z.number().int().min(90).max(1825),
  /** Past appointments needed before a share means anything. */
  minAppointments: z.number().int().min(2).max(20),
  /** Share of past appointments missed (percent) from which an appointment is flagged. */
  missedPercent: z.number().int().min(10).max(100),
});
export type NoShowRiskParameters = z.infer<typeof noShowRiskParameters>;

export const NO_SHOW_RISK_RULE: RuleDefinition<NoShowRiskParameters> = {
  id: "clinic.no-show-risk",
  version: 1,
  domain: "clinic",
  title: "A patient may not come to their appointment",
  description:
    "Flags the day's appointments whose patient missed a large share of their past appointments here, so someone can call to confirm. It reads only attendance.",
  surfaces: ["appointments"],
  requires: ["appointment.read"],
  parametersSchema: noShowRiskParameters,
  defaultParameters: { historyDays: 730, minAppointments: 3, missedPercent: 34 },
  parameterLabels: {
    missedPercent: { label: "Flag when they missed at least", unit: "% of past appointments", min: 10, max: 100 },
    minAppointments: { label: "Past appointments needed", unit: "appointments", min: 2, max: 20, hint: "Patients with fewer are never flagged." },
    historyDays: { label: "Count appointments from the last", unit: "days", min: 90, max: 1825 },
  },
  reads:
    "The day's appointments at the facility (time, confirmed or not) and each patient's past appointments here over the days you set, attended or marked no-show, records merged into theirs included. Never a diagnosis, age, sex or address.",
  knownFalsePositives: [
    "A no-show recorded for a patient who came but was never checked in (automatic no-shows included), or marked by mistake.",
    "Past missed appointments whose cause has passed, such as a move or a change of work.",
  ],
  blindSpots: [
    "New patients, and patients with fewer past appointments than you set.",
    "Late cancellations: only appointments marked no-show count as missed.",
    "Appointments at other clinics.",
  ],
};

export interface NoShowRiskInput {
  appointmentId: string;
  /** ISO instant */
  startsAt: string;
  /** YYYY-MM-DD, the facility's day of the appointment. */
  date: string;
  confirmed: boolean;
  /** Past appointments of the patient (and records merged into theirs) the patient came to. */
  attended: number;
  /** Past appointments marked no-show. */
  missed: number;
}

export function noShowRiskSuggestions(inputs: readonly NoShowRiskInput[], params: NoShowRiskParameters, timeZone: string): Suggestion[] {
  const time = new Intl.DateTimeFormat("en-PH", { timeZone, hour: "numeric", minute: "2-digit" });
  const out: Suggestion[] = [];
  // In the order of the day.
  for (const a of [...inputs].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    const total = a.attended + a.missed;
    if (total < params.minAppointments || a.missed === 0) continue;
    if ((a.missed / total) * 100 < params.missedPercent) continue;
    const at = time.format(new Date(a.startsAt));
    out.push({
      id: suggestionId(NO_SHOW_RISK_RULE.id, NO_SHOW_RISK_RULE.version, `appointment:${a.appointmentId}`),
      ruleId: NO_SHOW_RISK_RULE.id,
      ruleVersion: NO_SHOW_RISK_RULE.version,
      surface: "appointments",
      severity: a.confirmed ? "info" : "advice",
      title: `${at} appointment: the patient missed ${a.missed} of their last ${total} appointments`,
      rationale: a.confirmed
        ? "The appointment is confirmed, so this is only for your information."
        : "The appointment is not confirmed yet. Consider calling to confirm, and keep the waiting list in mind if they cannot come.",
      evidence: [
        { label: "Past appointments missed", resourceType: "appointment", resourceId: a.appointmentId, value: `${a.missed} of ${total}` },
        { label: "Confirmed", resourceType: "appointment", resourceId: a.appointmentId, value: a.confirmed ? "Yes" : "Not yet" },
      ],
      basis: "rule",
      strength: total >= params.minAppointments * 2 ? "matched" : "weak",
      requires: [...NO_SHOW_RISK_RULE.requires],
      action: { label: "Open the appointment", href: `/appointments?date=${a.date}&appointmentId=${a.appointmentId}` },
    });
  }
  return out;
}
