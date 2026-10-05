/** An error answer from the API: `{ error: { code, message, requestId } }` (docs/api/conventions.md). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async from(response: Response): Promise<ApiError> {
    let body: { error?: { code?: string; message?: string; requestId?: string } } | undefined;
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = undefined;
    }
    return new ApiError(
      response.status,
      body?.error?.code ?? "http_error",
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.requestId,
    );
  }
}

/** The session ended (refused refresh, sign-out elsewhere, access withdrawn): the patient must sign in again. */
export class SessionEndedError extends Error {
  constructor() {
    super("Your session has ended. Sign in again.");
    this.name = "SessionEndedError";
  }
}

/**
 * A message for patients: plain language, with a support reference when the API gave one. Same wording as MyHealth on
 * the web (apps/portal/src/lib/forms.ts `patientMessage`).
 */
export function patientMessage(error: unknown): string {
  if (error instanceof SessionEndedError) return error.message;
  if (!(error instanceof ApiError)) return "We couldn't reach MyHealth. Check your connection and try again.";
  const ref = error.requestId ? ` (ref ${error.requestId.slice(0, 8)})` : "";
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.code === "mfa_enrollment_required")
    return "Your clinic requires two-step verification. Set it up in MyHealth on the web (Profile → Sign-in security), then sign in again.";
  if (error.code === "validation_failed") return `Some details were not accepted. Check them and try again.${ref}`;
  if (error.status >= 500) return `Something went wrong on our side. Try again in a few minutes.${ref}`;
  return `${error.message}${ref}`;
}
