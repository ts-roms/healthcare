/**
 * Idle sign-out for shared clinic computers (docs/security/data-privacy-act.md, "Security measures"): after a period
 * without keyboard or pointer activity the staff app warns, then signs the browser out. The period is the
 * organization's deployment choice (`STAFF_IDLE_MINUTES`, default 20; 0 turns it off); the server-side session and
 * refresh expiry stay the real limit.
 */
export const DEFAULT_IDLE_MINUTES = 20;
/** How long the warning shows before the sign-out. */
export const IDLE_WARNING_SECONDS = 60;

/** The configured idle period in minutes; 0 (off) when disabled; the default when unset or not a number. */
export function parseIdleMinutes(raw: string | undefined, fallback = DEFAULT_IDLE_MINUTES): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), 24 * 60);
}

export type IdleState = "active" | "warning" | "expired";

/** Where the session stands `now` given the last activity and the idle period (minutes). */
export function idleState(lastActivity: number, now: number, minutes: number): { state: IdleState; secondsLeft: number } {
  const limitMs = minutes * 60_000;
  const elapsed = now - lastActivity;
  const secondsLeft = Math.max(0, Math.ceil((limitMs - elapsed) / 1000));
  if (elapsed >= limitMs) return { state: "expired", secondsLeft: 0 };
  if (secondsLeft <= IDLE_WARNING_SECONDS) return { state: "warning", secondsLeft };
  return { state: "active", secondsLeft };
}
