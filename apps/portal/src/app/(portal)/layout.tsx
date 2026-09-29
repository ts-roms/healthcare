import { ApiError } from "@healthcare/web-session";
import { PortalShell } from "@/components/portal-shell";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalDentalAvailability } from "@/lib/api/types";
import { signOut } from "./actions";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const [me, { unread }, dental] = await Promise.all([
    getMe(),
    portalApi<{ unread: number }>("/portal/messages/unread-count"),
    // "Dental" appears only when the clinic shares dental records and there is something to show; an API error hides it.
    portalApi<PortalDentalAvailability>("/portal/dental/availability").catch((e: unknown) => {
      if (e instanceof ApiError) return { available: false };
      throw e;
    }),
  ]);
  return (
    <PortalShell givenName={me.patient.givenName} timeZone={me.timeZone} unreadMessages={unread} dental={dental.available} signOut={signOut}>
      {children}
    </PortalShell>
  );
}
