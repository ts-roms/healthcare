import type { PortalAppointment, PortalPrescription } from "./api/types";

/**
 * Plain-language wording for the patient's own records. It explains where a
 * value sits against the laboratory's range; it never interprets what it means
 * for the patient's health — that is the doctor's conversation.
 *
 * The result wording lives in `@healthcare/domain/portal-results`, shared with the mobile app.
 */
export { latestPerTest, resultDate, resultMeaning, resultValue, usualRange, type ResultTone } from "@healthcare/domain/portal-results";

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
