/** The API's error envelope: `{ error: { code, message, details?, requestId? } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** An error response from the healthcare API, carrying its envelope fields. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Parses the API's `{ error: { code, message, details, requestId } }` envelope, tolerating non-JSON bodies. */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    body = undefined;
  }
  const e = body?.error;
  if (e && typeof e.code === "string" && typeof e.message === "string") {
    return new ApiError(response.status, e.code, e.message, e.details, e.requestId);
  }
  return new ApiError(response.status, `http_${response.status}`, response.statusText || "Request failed");
}

/** A message safe to show to staff, with the request id for support when available. */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message} (ref ${error.requestId.slice(0, 8)})` : error.message;
  }
  return "The server could not be reached. Try again.";
}
