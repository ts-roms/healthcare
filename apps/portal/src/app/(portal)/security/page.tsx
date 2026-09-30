import { portalApi } from "@/lib/api/client";
import type { PortalEmailStatus, PortalMfaStatus } from "@/lib/api/types";
import { getMe } from "@/lib/api/session";
import { EmailSection } from "./email-section";
import { MfaSection } from "./mfa-section";

export const metadata = { title: "Sign-in security" };

export default async function SecurityPage() {
  const [email, mfa, { timeZone }] = await Promise.all([portalApi<PortalEmailStatus>("/portal/email"), portalApi<PortalMfaStatus>("/portal/mfa"), getMe()]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Sign-in security</h1>
        <p className="text-body text-muted-foreground">Keep your records safe: confirm your email, and add a second step when you sign in.</p>
      </div>
      <EmailSection status={email} mfaEnabled={mfa.enabled} />
      <MfaSection status={mfa} timeZone={timeZone} />
    </div>
  );
}
