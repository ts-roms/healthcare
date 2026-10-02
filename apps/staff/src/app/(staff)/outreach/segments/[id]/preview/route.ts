import { api } from "@/lib/api/client";
import type { OutreachSegmentPreview } from "@/lib/api/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A segment preview for the Outreach page, fetched with the user's session; the API authorizes and audits it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  try {
    const preview = await api<OutreachSegmentPreview>(`/outreach/segments/${id}/preview`);
    return Response.json(preview, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return new Response("The preview could not be loaded.", { status: 502 });
  }
}
