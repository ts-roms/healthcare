import { apiFile } from "@/lib/api/client";
import { EXPORT_TABLES } from "@/lib/management-mapping";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CSV downloads of the management dashboard, fetched from the API with the user's session. The API authorizes, scopes
 * to the caller's facilities and audits every export; this passes only known tables and well-formed filters through.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const table = params.get("table") ?? "";
  if (!EXPORT_TABLES.some((t) => t.key === table)) return new Response("Not found", { status: 404 });
  const pick = (name: string, pattern: RegExp) => {
    const value = params.get(name);
    return value && pattern.test(value) ? value : undefined;
  };
  const upstream = await apiFile("/management/dashboard/export", {
    accept: "text/csv",
    query: {
      table,
      from: pick("from", DATE),
      to: pick("to", DATE),
      facilityId: pick("facilityId", UUID),
      comparison: pick("comparison", /^(previous|last-year)$/),
    },
  });
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "You do not have access to these figures."
        : upstream.status === 400
          ? "Choose a valid range."
          : "The export could not be produced.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="management.csv"',
      "cache-control": "private, no-store",
    },
  });
}
