import { ApiError } from "@healthcare/web-session";
import { PortalShell } from "@/components/portal-shell";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalDentalAvailability, PortalDependent } from "@/lib/api/types";
import { RELATIONSHIP_LABEL } from "@/lib/proxy-access";
import { signOut } from "./actions";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const [me, { unread }, dental, dependents] = await Promise.all([
    getMe(),
    portalApi<{ unread: number }>("/portal/messages/unread-count"),
    // "Dental" appears only when the clinic shares dental records and there is something to show; an API error hides it.
    portalApi<PortalDentalAvailability>("/portal/dental/availability").catch((e: unknown) => {
      if (e instanceof ApiError) return { available: false };
      throw e;
    }),
    // "Switch person" appears only for someone the clinic has given access to another person's record.
    portalApi<PortalDependent[]>("/portal/proxy/dependents").catch((e: unknown) => {
      if (e instanceof ApiError) return [];
      throw e;
    }),
  ]);
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
      {children}
    </PortalShell>
  );
}
