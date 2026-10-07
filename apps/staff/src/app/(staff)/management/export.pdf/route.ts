import { apiFile } from "@/lib/api/client";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The management dashboard as one PDF, fetched from the API with the user's session. The API authorizes, scopes to
 * the caller's facilities, prints withheld sections as not available and audits the export; this passes only
 * well-formed filters through.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pick = (name: string, pattern: RegExp) => {
    const value = params.get(name);
    return value && pattern.test(value) ? value : undefined;
  };
  const upstream = await apiFile("/management/dashboard/export.pdf", {
    query: {
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
          : "The PDF could not be produced.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="management-dashboard.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
