import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { PortalShell } from "@/components/portal-shell";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalDentalAvailability, PortalDependent } from "@/lib/api/types";
import { RELATIONSHIP_LABEL } from "@/lib/proxy-access";
import { mfaPolicyNotice } from "@/lib/security";
import { signOut } from "./actions";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  // While the clinic requires two-step verification this account has not set up, only Sign-in security and the profile
  // answer; the rest is not asked for (the API would refuse it and the client would redirect).
  const gated = me.mfaPolicy.enrollmentRequired;
  const [{ unread }, dental, dependents] = await Promise.all([
    gated ? { unread: 0 } : portalApi<{ unread: number }>("/portal/messages/unread-count"),
    // "Dental" appears only when the clinic shares dental records and there is something to show; an API error hides it.
    gated
      ? { available: false }
      : portalApi<PortalDentalAvailability>("/portal/dental/availability").catch((e: unknown) => {
          if (e instanceof ApiError) return { available: false };
          throw e;
        }),
    // "Switch person" appears only for someone the clinic has given access to another person's record.
    gated
      ? ([] as PortalDependent[])
      : portalApi<PortalDependent[]>("/portal/proxy/dependents").catch((e: unknown) => {
          if (e instanceof ApiError) return [];
          throw e;
        }),
  ]);
  const notice = mfaPolicyNotice(me.mfaPolicy, me.account.mfaEnabled);
  const acting = me.acting
    ? {
        name: me.patient.displayName,
        relationship: RELATIONSHIP_LABEL[me.acting.relationship] ?? me.acting.relationship,
        viewOnly: !me.acting.scopes.includes("act"),
      }
    : null;
  return (
    <PortalShell
      givenName={me.patient.givenName}
      timeZone={me.timeZone}
      unreadMessages={unread}
      dental={dental.available}
      acting={acting}
      hasDependents={dependents.length > 0}
      signOut={signOut}
    >
      {notice ? (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/50 bg-warning-subtle p-3 text-body"
        >
          <span>
            <ShieldAlertIcon className="mr-1.5 inline size-4" aria-hidden />
            {notice}
          </span>
          <Link href="/security" className="font-medium text-primary underline">
            Set it up
          </Link>
        </div>
      ) : null}
      {children}
    </PortalShell>
  );
}
