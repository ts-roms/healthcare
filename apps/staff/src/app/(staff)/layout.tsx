import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { StaffShell } from "@/components/staff-shell";
import { api } from "@/lib/api/client";
import { COOKIES } from "@/lib/api/config";
import { getFacilities, getSession } from "@/lib/api/session";
import { setRequestTimeZone } from "@/lib/time-zone";
import { PasswordForm, TwoStepSettings } from "./account/account-forms";

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
    >
      {session.user.passwordChangeRequired ? <ChooseNewPassword /> : session.user.mfaEnrollmentRequired ? <SetUpTwoStep /> : children}
    </StaffShell>
  );
}

/**
 * Signed in with a temporary password from an administrator: every page asks for a new one first (the API refuses
 * everything else until then; migration 0088).
 */
function SetUpTwoStep() {
  return (
    <div className="mx-auto w-full max-w-lg p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <ShieldCheckIcon className="mr-1 inline size-4" aria-hidden /> Set up two-step verification
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-table">
          <p className="text-muted-foreground">
            Your organization requires two-step verification. Add your account to an authenticator app on your phone and enter the code it shows. Nothing else
            opens until you do.
          </p>
          <TwoStepSettings enabled={false} />
        </CardContent>
      </Card>
    </div>
  );
}

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
