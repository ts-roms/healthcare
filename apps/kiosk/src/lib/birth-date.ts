/** A date of birth typed as three plain fields, because a calendar picker is slow and confusing on a kiosk. */
export interface BirthDateParts {
  day: string;
  month: string;
  year: string;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** `YYYY-MM-DD` when the three fields make a real day between 1880 and `today` (itself a `YYYY-MM-DD`), else null. */
export function toIsoDate({ day, month, year }: BirthDateParts, today: string): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (y < 1880 || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso > today ? null : iso;
}

/** A field-level problem with the date of birth (it spans three inputs, so a schema cannot place it). */
export function birthDateProblem(parts: BirthDateParts, today: string): string | null {
  return toIsoDate(parts, today) ? null : "Enter your birth date as day, month and year";
}

export const EMPTY_BIRTH_DATE: BirthDateParts = { day: "", month: "", year: "" };
