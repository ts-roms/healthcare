/**
 * A person who walks away must not leave their details on the screen. The kiosk warns after `WARN_AFTER_MS` without a
 * touch and starts over `GRACE_MS` later; the server ends the session after its own two idle minutes regardless.
 */
export const WARN_AFTER_MS = 60_000;
export const GRACE_MS = 20_000;
/** The ticket and the registration receipt need no further input: the screen clears itself after this long. */
export const RECEIPT_CLEAR_MS = 45_000;
/** A locked-out person is sent to the desk; the screen clears itself after this long. */
export const LOCKED_CLEAR_MS = 15_000;

export type IdleState = { kind: "active" } | { kind: "warning"; secondsLeft: number } | { kind: "expired" };

export function idleState(lastTouchAt: number, now: number, warnAfterMs = WARN_AFTER_MS, graceMs = GRACE_MS): IdleState {
  const idle = now - lastTouchAt;
  if (idle < warnAfterMs) return { kind: "active" };
  if (idle >= warnAfterMs + graceMs) return { kind: "expired" };
  return { kind: "warning", secondsLeft: Math.ceil((warnAfterMs + graceMs - idle) / 1000) };
}
