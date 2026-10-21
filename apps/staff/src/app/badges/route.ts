import { api } from "@/lib/api/client";
import type { StaffBadges } from "@/lib/api/types";

/**
 * The navigation counts and the unread in-app notices for the signed-in user, refreshed by the shell every minute and
 * when the realtime socket says a notice arrived (the API checks each permission).
 */
export async function GET() {
  try {
    const [badges, notices] = await Promise.all([api<StaffBadges>("/me/badges"), api<{ unread: number }>("/me/notifications/unread-count")]);
    return Response.json({ ...badges, unreadNotices: notices.unread }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return new Response(null, { status: 204 });
  }
}
