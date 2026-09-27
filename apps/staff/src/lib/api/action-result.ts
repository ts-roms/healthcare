import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ApiError, userMessage } from "@healthcare/web-session";

/** What a server action returns to a client form: never throws for API errors, so the form can show them. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string; code?: string; details?: unknown };

const MESSAGES: Record<string, string> = {
  version_conflict: "Someone else updated this just now. The screen has been refreshed — check it and try again.",
  facility_required: "Select your facility in the top bar first.",
  slot_unavailable: "That time was just taken. Choose another slot.",
};

/** Runs an API call for a server action, turning API errors into a result and letting Next's redirects through. */
export async function actionResult<T>(call: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    // The session ended (redirect to sign-in) or another Next control-flow signal.
    unstable_rethrow(error);
    if (error instanceof ApiError) return { ok: false, code: error.code, details: error.details, message: MESSAGES[error.code] ?? userMessage(error) };
    return { ok: false, message: userMessage(error) };
  }
}
