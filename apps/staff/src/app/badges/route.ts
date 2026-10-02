import { api } from "@/lib/api/client";
import type { StaffBadges } from "@/lib/api/types";

/** The navigation counts for the signed-in user, refreshed by the shell every minute (the API checks each permission). */
export async function GET() {
  try {
    const badges = await api<StaffBadges>("/me/badges");
    return Response.json(badges, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return new Response(null, { status: 204 });
  }
}
