import { cookies } from "next/headers";
import { StaffShell } from "@/components/staff-shell";
import { COOKIES } from "@/lib/api/config";
import { getFacilities, getSession } from "@/lib/api/session";

/** Every staff page renders inside the signed-in shell; the session and permissions come from the API. */
export default async function StaffGroupLayout({ children }: { children: React.ReactNode }) {
  const [session, facilities, jar] = await Promise.all([getSession(), getFacilities(), cookies()]);
  return (
    <StaffShell
      permissions={session.permissions}
      user={{ displayName: session.user.displayName, email: session.user.email }}
      organizationName={session.organization.name}
      facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
      facilityId={jar.get(COOKIES.facility)?.value ?? null}
    >
      {children}
    </StaffShell>
  );
}
