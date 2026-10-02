import { apiFile } from "@/lib/api/client";
import { EXPORT_TABLES } from "@/lib/management-mapping";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One stored table of a produced management report, fetched from the API with the user's session. The API checks
 * the dashboard permission (and billing reporting for revenue tables) and audits every download.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; table: string }> }) {
  const { id, table } = await params;
  if (!UUID.test(id) || !EXPORT_TABLES.some((t) => t.key === table)) return new Response("Not found", { status: 404 });
  const upstream = await apiFile(`/management/reports/${id}/files/${table}`, { accept: "text/csv" });
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "You do not have access to these figures."
        : upstream.status === 404
          ? "This file was not produced."
          : "The file could not be read.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="management-report.csv"',
      "cache-control": "private, no-store",
    },
  });
}
