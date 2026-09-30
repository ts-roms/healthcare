import { ShieldAlertIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { TwoStepSettings } from "@/app/(staff)/account/account-forms";
import { PageHeader } from "./page-header";

/**
 * Shown on every staff page while the organization requires two-step verification the signed-in member has not set up.
 * The API refuses everything else (`403 mfa_enrollment_required`) until they do; once it is on, the page they asked
 * for opens.
 */
export function MfaEnrollmentGate({ organizationName }: { organizationName: string }) {
  return (
    <>
      <PageHeader title="Set up two-step verification" description={organizationName} />
      <div className="max-w-2xl p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlertIcon aria-hidden className="size-4" /> Required by your organization
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p>
              {organizationName} requires two-step verification for staff. Set it up now to continue: signing in will also ask for a 6-digit code from an
              authenticator app on your phone, so a stolen password alone is not enough.
            </p>
            <p className="text-muted-foreground">No phone you can use? Ask your administrator.</p>
            <TwoStepSettings enabled={false} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
