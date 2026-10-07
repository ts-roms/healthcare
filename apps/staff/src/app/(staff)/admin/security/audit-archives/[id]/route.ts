import { apiFile } from "@/lib/api/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A verified archive of one month of the audit trail (gzipped JSON lines), fetched from the API with the user's session.
 * The API allows platform administrators only, checks the file against its recorded checksum and audits the download.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const upstream = await apiFile(`/audit/retention/archives/${id}/file`, { accept: "application/gzip" });
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "Only platform administrators can download audit archives."
        : upstream.status === 404
          ? "Archive not found."
          : "The archive could not be read.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="audit-archive.jsonl.gz"',
      "cache-control": "private, no-store",
    },
  });
}
