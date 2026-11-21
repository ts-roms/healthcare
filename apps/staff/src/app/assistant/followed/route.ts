import { z } from "zod";
import { api } from "@/lib/api/client";

const bodySchema = z.object({ id: z.string().min(3).max(300) });

/**
 * Counts that the signed-in person followed an assistant suggestion's link (outcome "accepted",
 * docs/domains/assistant.md). The panel sends it with `navigator.sendBeacon`, so it survives the page changing and never
 * delays the navigation. Same-origin requests only; the API checks the session, the facility and the rule.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  try {
    await api(`/assistant/suggestions/${encodeURIComponent(parsed.data.id)}/feedback`, { method: "POST", body: { outcome: "accepted" } });
  } catch {
    // Decision support: a lost "followed" count never matters to the person.
  }
  return new Response(null, { status: 204 });
}
