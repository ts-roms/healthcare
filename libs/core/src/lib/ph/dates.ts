export const PH_TIMEZONE = "Asia/Manila";

/** Today's calendar date in the Philippines as YYYY-MM-DD. */
export function todayInPhilippines(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: PH_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Completed years between a YYYY-MM-DD birth date and a YYYY-MM-DD reference date. */
export function ageInYears(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = onDate.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}
