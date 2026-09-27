/**
 * Conversions between instants (stored in UTC) and wall-clock time in a
 * facility's time zone (Asia/Manila by default). Uses the platform's IANA
 * time-zone data, so it stays correct for zones with DST too.
 */

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-10-05" + "09:30" in Asia/Manila → 2026-10-05T01:30:00Z. */
export function zonedToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss = 0] = localTime.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Two passes handle offset changes around DST transitions.
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** The local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** The local wall-clock time (HH:MM, 24-hour) of an instant. */
export function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
}

/** Day of week of a calendar date: 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** UTC instants bounding a local calendar day: [start, end). */
export function localDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: zonedToUtc(date, '00:00', timeZone), end: zonedToUtc(next, '00:00', timeZone) };
}

export function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}
