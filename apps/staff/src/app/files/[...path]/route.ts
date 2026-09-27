import { apiFile } from "@/lib/api/client";
import { fileApiPath } from "@/lib/files";

/**
 * Printable documents (laboratory reports, invoices, receipts) fetched from
 * the API with the user's session and shown inline. The API authorizes and
 * audits every download; this only passes known document paths through.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const apiPath = fileApiPath((await params).path);
  if (!apiPath) return new Response("Not found", { status: 404 });
  const upstream = await apiFile(apiPath);
  if (!upstream.ok) {
    const message =
      upstream.status === 403
        ? "You do not have access to this document."
        : upstream.status === 404
          ? "Document not found."
          : "The document could not be produced.";
    return new Response(message, { status: upstream.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
    },
  });
}
