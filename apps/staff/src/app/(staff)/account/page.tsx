import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/api/session";
import { PasswordForm, TwoStepSettings } from "./account-forms";

export const metadata = { title: "My account" };

/** The signed-in person's own sign-in settings: password and two-step verification. */
export default async function AccountPage() {
  const session = await getSession();
  return (
    <>
      <PageHeader title="My account" description={`${session.user.displayName} · ${session.user.email} · ${session.organization.name}`} />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="text-muted-foreground">Changing it signs you out everywhere else; this session stays signed in.</p>
            <PasswordForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Two-step verification</CardTitle>
            {session.user.mfaEnabled ? (
              <Badge variant="success" className="ml-auto">
                <ShieldCheckIcon aria-hidden /> On
              </Badge>
            ) : (
              <Badge variant="neutral" className="ml-auto">
                <ShieldOffIcon aria-hidden /> Off
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="text-muted-foreground">
              With it on, signing in also asks for a 6-digit code from an authenticator app on your phone, so a stolen password alone is not enough.
            </p>
            <TwoStepSettings enabled={session.user.mfaEnabled} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
