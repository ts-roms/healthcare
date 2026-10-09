import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { KeyRoundIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { MfaEnrollmentGate } from "@/components/mfa-enrollment-gate";
import { StaffShell } from "@/components/staff-shell";
import { api } from "@/lib/api/client";
import { COOKIES } from "@/lib/api/config";
import { getFacilities, getSession } from "@/lib/api/session";
import type { StaffBadges } from "@/lib/api/types";
import { isDisplayOnly } from "@/lib/queue-display";
import { setRequestTimeZone } from "@/lib/time-zone";
import { PasswordForm } from "./account/account-forms";

/** The top bar's badge; a failure here never takes the page down. */
async function unreadNotices(): Promise<number> {
  try {
    return (await api<{ unread: number }>("/me/notifications/unread-count")).unread;
  } catch (error) {
    unstable_rethrow(error);
    return 0;
  }
}

/** Counts for the navigation; a failure here never takes the page down. */
async function navigationBadges(): Promise<StaffBadges | null> {
  try {
    return await api<StaffBadges>("/me/badges");
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** Every staff page renders inside the signed-in shell; the session and permissions come from the API. */
export default async function StaffGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // A waiting-room display account holds nothing else: it only ever shows the display.
  if (isDisplayOnly(session.permissions)) redirect("/display/queue");
  const [facilities, jar, unread, badges] = await Promise.all([getFacilities(), cookies(), unreadNotices(), navigationBadges()]);
  const facilityId = jar.get(COOKIES.facility)?.value ?? null;
  const timeZone = facilities.find((f) => f.id === facilityId)?.timezone ?? null;
  setRequestTimeZone(timeZone);
  return (
    <StaffShell
      permissions={session.permissions}
      user={{ displayName: session.user.displayName, email: session.user.email }}
      organizationName={session.organization.name}
      facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
      facilityId={facilityId}
      timeZone={timeZone}
      unreadNotices={unread}
      badges={badges}
    >
      {/* Until the member replaces a temporary password, or sets up the two-step verification their organization requires, the API opens nothing else. */}
      {session.user.passwordChangeRequired ? (
        <ChooseNewPassword />
      ) : session.mfaPolicy.enrollmentRequired ? (
        <MfaEnrollmentGate organizationName={session.organization.name} />
      ) : (
        children
      )}
    </StaffShell>
  );
}

/**
 * Signed in with a temporary password from an administrator: every page asks for a new one first (the API refuses
 * everything else until then; migration 0090).
 */
function ChooseNewPassword() {
  return (
    <div className="mx-auto w-full max-w-lg p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <KeyRoundIcon className="mr-1 inline size-4" aria-hidden /> Choose your own password
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-table">
          <p className="text-muted-foreground">
            An administrator gave you a temporary password. Enter it, then choose a new one that only you know. Nothing else opens until you do.
          </p>
          <PasswordForm temporary />
        </CardContent>
      </Card>
    </div>
  );
}
