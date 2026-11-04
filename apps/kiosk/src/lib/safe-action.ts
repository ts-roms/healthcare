import type { Result } from "@/app/actions";

/** What the person reads when the kiosk could not reach its own server at all (no answer, a dropped connection, a gateway error). */
export const UNREACHABLE = "We could not reach the system just now. Please try again, or see the front desk.";

/**
 * Calls a server action and turns a call that never came back (the connection dropped, the answer was lost, the server
 * was restarting) into the same plain failure an answered error is, so a screen is never left waiting on a button that
 * can no longer be pressed. The action's own answers, errors included, pass through untouched.
 */
export async function safely<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, message: UNREACHABLE, code: "unreachable" };
  }
}
