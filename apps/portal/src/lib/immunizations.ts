import type { PortalImmunization } from "./api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a dose was given, as precisely as it is known: "2019", "May 2019", "12 May 2019" (a time is shown as its day). */
export function whenGiven(i: Pick<PortalImmunization, "occurrence" | "occurrencePrecision">, timeZone: string): string {
  if (i.occurrencePrecision === "year") return i.occurrence.slice(0, 4);
  if (i.occurrencePrecision === "month") return `${MONTHS[Number(i.occurrence.slice(5, 7)) - 1] ?? ""} ${i.occurrence.slice(0, 4)}`.trim();
  // A calendar day is shown as is; an instant as its day in the clinic's time zone.
  const day = i.occurrencePrecision === "day";
  const date = day ? new Date(`${i.occurrence}T00:00:00Z`) : new Date(i.occurrence);
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: day ? "UTC" : timeZone }).format(date);
}

/** Where the record comes from, in plain words. */
export function sourceText(source: PortalImmunization["source"]): string {
  if (source === "administered_here") return "Given at our clinic";
  if (source === "historical") return "Recorded from your vaccination record";
  return "From another provider's records";
}

/** Doses grouped by vaccine (A–Z), newest first within each (as the API lists them). */
export function byVaccine(items: readonly PortalImmunization[]): Array<{ vaccine: string; doses: PortalImmunization[] }> {
  const groups = new Map<string, { vaccine: string; doses: PortalImmunization[] }>();
  for (const i of items) {
    const key = i.vaccineName.trim().toLowerCase();
    const group = groups.get(key) ?? { vaccine: i.vaccineName, doses: [] };
    group.doses.push(i);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.vaccine.localeCompare(b.vaccine));
}
