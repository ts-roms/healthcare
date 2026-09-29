import type { PortalAppointment, PortalPrescription, PortalResult } from "./api/types";

/**
 * Plain-language wording for the patient's own records. It explains where a
 * value sits against the laboratory's range; it never interprets what it means
 * for the patient's health — that is the doctor's conversation.
 */

export type ResultTone = "normal" | "attention" | "urgent" | "neutral";

export function resultMeaning(result: Pick<PortalResult, "flag">): { tone: ResultTone; text: string } {
  switch (result.flag) {
    case "normal":
      return { tone: "normal", text: "Within the usual range" };
    case "high":
      return { tone: "attention", text: "Higher than the usual range" };
    case "low":
      return { tone: "attention", text: "Lower than the usual range" };
    case "abnormal":
      return { tone: "attention", text: "Outside what is usually expected" };
    case "critical_high":
      return { tone: "urgent", text: "Much higher than the usual range — your care team has been told" };
    case "critical_low":
      return { tone: "urgent", text: "Much lower than the usual range — your care team has been told" };
    default:
      return { tone: "neutral", text: "No usual range to compare with" };
  }
}

export function resultValue(result: Pick<PortalResult, "resultType" | "valueNumeric" | "valueText" | "valueCoded">): string {
  if (result.resultType === "numeric") return result.valueNumeric === null ? "—" : String(result.valueNumeric);
  return (result.resultType === "coded" ? result.valueCoded : result.valueText) ?? "—";
}

/** "Usual range: 3.9 to 5.5 mmol/L" */
export function usualRange(result: Pick<PortalResult, "refLow" | "refHigh" | "refText" | "unit">): string | null {
  const unit = result.unit ? ` ${result.unit}` : "";
  if (result.refLow !== null && result.refHigh !== null) return `Usual range: ${result.refLow} to ${result.refHigh}${unit}`;
  if (result.refHigh !== null) return `Usual range: up to ${result.refHigh}${unit}`;
  if (result.refLow !== null) return `Usual range: ${result.refLow}${unit} or more`;
  return result.refText ? `Expected: ${result.refText}` : null;
}

/** The latest visible result per test, newest first. */
export function latestPerTest(results: PortalResult[]): Array<{ latest: PortalResult; count: number }> {
  const byTest = new Map<string, PortalResult[]>();
  for (const r of results) byTest.set(r.testId, [...(byTest.get(r.testId) ?? []), r]);
  return [...byTest.values()]
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => when(b) - when(a));
      return { latest: sorted[0]!, count: rows.length };
    })
    .sort((a, b) => when(b.latest) - when(a.latest));
}

function when(r: PortalResult): number {
  return new Date(r.collectedAt ?? r.releasedAt ?? 0).getTime();
}

const FREQUENCY: Record<string, string> = {
  once: "once",
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  four_times_daily: "four times a day",
  every_4_hours: "every 4 hours",
  every_6_hours: "every 6 hours",
  every_8_hours: "every 8 hours",
  every_12_hours: "every 12 hours",
  at_bedtime: "at bedtime",
  weekly: "once a week",
};

/** "1 tablet twice a day for 7 days" style summary; the prescriber's instructions stay the authority. */
export function howToTake(item: PortalPrescription["items"][number]): string {
  const dose = item.doseAmount !== null ? `${item.doseAmount} ${item.doseUnit ?? ""}`.trim() : null;
  const frequency =
    item.frequency === "as_needed"
      ? `when needed${item.asNeededReason ? ` for ${item.asNeededReason}` : ""}`
      : item.frequency === "custom"
        ? (item.frequencyText ?? "")
        : (FREQUENCY[item.frequency] ?? item.frequency.replaceAll("_", " "));
  const duration =
    item.durationValue && item.durationUnit
      ? `for ${item.durationValue} ${item.durationValue === 1 ? item.durationUnit.replace(/s$/, "") : item.durationUnit}`
      : null;
  return [dose, frequency, duration].filter(Boolean).join(" ");
}

export const APPOINTMENT_STATUS: Record<PortalAppointment["status"], string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Missed",
};

/** "Wed, Sep 30, 2026, 9:30 AM" in the clinic's time zone. */
export function visitTime(appointment: Pick<PortalAppointment, "startsAt" | "timeZone">): string {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: appointment.timeZone,
  }).format(new Date(appointment.startsAt));
}

/** "30 Sep 2026" in the patient's clinic's time zone (results, prescriptions and bills carry instants). */
export function resultDate(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}
