import { unstable_rethrow } from "next/navigation";
import { ApiError, userMessage } from "@healthcare/web-session";

/** What a server action hands back to a client component: data, or a message (and the API's error code) to show. */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string; code?: string; fields?: Record<string, string> };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function run<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      const fields = Array.isArray(error.details)
        ? Object.fromEntries((error.details as Array<{ path?: string; message?: string }>).filter((d) => d.path).map((d) => [d.path!, d.message ?? ""]))
        : undefined;
      return { ok: false, message: error.message, code: error.code, fields };
    }
    return { ok: false, message: userMessage(error) };
  }
}
