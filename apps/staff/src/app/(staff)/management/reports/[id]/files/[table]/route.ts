import { apiFile } from "@/lib/api/client";
import { PDF_REPORT, REPORT_FILES } from "@/lib/management-mapping";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One stored file of a produced management report (a CSV table or the dashboard PDF), fetched from the API with the
 * user's session. The API checks the dashboard permission (and each gated section's permission) and audits every
 * download.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; table: string }> }) {
  const { id, table } = await params;
  if (!UUID.test(id) || !REPORT_FILES.some((t) => t.key === table)) return new Response("Not found", { status: 404 });
  const pdf = table === PDF_REPORT.key;
  const upstream = await apiFile(`/management/reports/${id}/files/${table}`, { accept: pdf ? "application/pdf" : "text/csv" });
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
      "content-type": pdf ? "application/pdf" : "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="management-report.${pdf ? "pdf" : "csv"}"`,
      "cache-control": "private, no-store",
    },
  });
}
