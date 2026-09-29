import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { StaffShell } from "@/components/staff-shell";
import { api } from "@/lib/api/client";
import { COOKIES } from "@/lib/api/config";
import { getFacilities, getSession } from "@/lib/api/session";

/** The top bar's badge; a failure here never takes the page down. */
async function unreadNotices(): Promise<number> {
  try {
    return (await api<{ unread: number }>("/me/notifications/unread-count")).unread;
  } catch (error) {
    unstable_rethrow(error);
    return 0;
  }
}

/** Every staff page renders inside the signed-in shell; the session and permissions come from the API. */
export default async function StaffGroupLayout({ children }: { children: React.ReactNode }) {
  const [session, facilities, jar, unread] = await Promise.all([getSession(), getFacilities(), cookies(), unreadNotices()]);
  return (
    <StaffShell
      permissions={session.permissions}
      user={{ displayName: session.user.displayName, email: session.user.email }}
      organizationName={session.organization.name}
      facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
      facilityId={jar.get(COOKIES.facility)?.value ?? null}
      unreadNotices={unread}
    >
      {children}
    </StaffShell>
  );
}
