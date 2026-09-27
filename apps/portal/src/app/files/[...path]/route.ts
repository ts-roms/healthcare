import { portalFile } from "@/lib/api/client";
import { fileApiPath } from "@/lib/files";

/** The patient's printable documents (laboratory reports, invoices), fetched with their MyHealth session. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const apiPath = fileApiPath((await params).path);
  if (!apiPath) return new Response("Not found", { status: 404 });
  const upstream = await portalFile(apiPath);
  if (!upstream.ok) {
    return new Response(upstream.status === 404 ? "This document is not available." : "The document could not be produced. Please try again later.", {
      status: upstream.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
    },
  });
}
