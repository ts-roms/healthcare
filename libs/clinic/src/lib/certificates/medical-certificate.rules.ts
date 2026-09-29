/**
 * Rest days on a medical certificate: both ends included (from 5 to 7 October is 3 days); null without a rest period.
 * Dates are calendar dates (YYYY-MM-DD).
 */
export function restDays(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days >= 1 ? days : null;
}
