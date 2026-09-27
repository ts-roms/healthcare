import { differenceInYears, parseISO } from "date-fns";
import type { Patient, Sex } from "@healthcare/domain";

/**
 * Clinical times are always shown in the facility's timezone, never the
 * server's or the browser's — a result "collected 01:42" when it was 09:42
 * is a patient-safety bug. Override per deployment with `setClinicTimeZone`.
 */
let clinicTimeZone = "Asia/Manila";

export function setClinicTimeZone(tz: string) {
  clinicTimeZone = tz;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cache = new Map<string, Intl.DateTimeFormat>();

function zoned(iso: string | Date) {
  const tz = clinicTimeZone;
  let fmt = cache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    cache.set(tz, fmt);
  }
  // Date-only values (birth dates, due dates) are calendar dates, not instants.
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return { y, m, d, time: "" };
  }
  const date = typeof iso === "string" ? parseISO(iso) : iso;
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), time: `${p.hour}:${p.minute}` };
}

export function ageFrom(birthDate: string, at: Date = new Date()) {
  return differenceInYears(at, parseISO(birthDate));
}

export function sexLabel(sex: Sex, short = false) {
  const map: Record<Sex, [string, string]> = {
    female: ["Female", "F"],
    male: ["Male", "M"],
    intersex: ["Intersex", "I"],
    other: ["Other", "O"],
    unknown: ["Unknown", "U"],
  };
  return map[sex][short ? 1 : 0];
}

export function fullName(p: Pick<Patient, "givenName" | "familyName">) {
  return `${p.givenName} ${p.familyName}`;
}

/** Clinical date convention: 27 Sep 2026 — unambiguous across locales. */
export function clinicalDate(iso: string) {
  const z = zoned(iso);
  return `${z.d} ${MONTHS[z.m - 1]} ${z.y}`;
}

export function clinicalDateTime(iso: string) {
  return `${clinicalDate(iso)}, ${clinicalTime(iso)}`;
}

/** 24-hour clock, facility time. */
export function clinicalTime(iso: string) {
  return zoned(iso).time;
}

export function clinicalMonth(iso: string) {
  return MONTHS[zoned(iso).m - 1]!;
}

export function relativeDay(iso: string, now: Date = new Date()) {
  const a = zoned(iso);
  const today = zoned(now);
  const yesterday = zoned(new Date(now.getTime() - 86_400_000));
  const same = (x: typeof a) => x.y === a.y && x.m === a.m && x.d === a.d;
  if (same(today)) return "Today";
  if (same(yesterday)) return "Yesterday";
  return `${a.d} ${MONTHS[a.m - 1]}`;
}
