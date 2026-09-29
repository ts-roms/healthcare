import { apiFile } from "@/lib/api/client";
import { csvApiQuery } from "@/lib/management-mapping";

/**
 * CSV download of one management dashboard section, fetched from the API with the user's session. The API authorizes
 * (management.dashboard.read; revenue sections also billing.report.read on every facility in scope), suppresses small
 * patient counts and audits the export; this only passes known sections and well-formed filters through.
 */
export async function GET(request: Request) {
  const query = csvApiQuery(new URL(request.url).searchParams);
  if (!query) return new Response("Unknown section", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const upstream = await apiFile("/management/dashboard.csv", { accept: "text/csv", query });
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "You do not have access to these figures."
        : upstream.status === 400 || upstream.status === 404
          ? "The filters are not valid."
          : "The export failed.";
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
