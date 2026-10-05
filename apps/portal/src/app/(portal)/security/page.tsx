import { ShieldAlertIcon } from "lucide-react";
import { portalApi } from "@/lib/api/client";
import type { PortalEmailStatus, PortalMfaStatus, PortalTrustedDevice } from "@/lib/api/types";
import { getMe } from "@/lib/api/session";
import { mfaPolicyNotice } from "@/lib/security";
import { DevicesSection } from "./devices-section";
import { EmailSection } from "./email-section";
import { MfaSection } from "./mfa-section";

export const metadata = { title: "Sign-in security" };

export default async function SecurityPage() {
  const [email, mfa, devices, me] = await Promise.all([
    portalApi<PortalEmailStatus>("/portal/email"),
    portalApi<PortalMfaStatus>("/portal/mfa"),
    portalApi<PortalTrustedDevice[]>("/portal/mfa/devices"),
    getMe(),
  ]);
  const notice = mfaPolicyNotice(me.mfaPolicy, me.account.mfaEnabled);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Sign-in security</h1>
        <p className="text-body text-muted-foreground">Keep your records safe: confirm your email, and add a second step when you sign in.</p>
      </div>
      {notice ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning-subtle p-3 text-body">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {notice}
        </p>
      ) : null}
      <EmailSection status={email} mfaEnabled={mfa.enabled} />
      <MfaSection status={mfa} timeZone={me.timeZone} />
      {mfa.enabled ? <DevicesSection devices={devices} timeZone={me.timeZone} /> : null}
    </div>
  );
}
