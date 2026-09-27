import { PortalShell } from "@/components/portal-shell";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import { signOut } from "./actions";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const [me, { unread }] = await Promise.all([getMe(), portalApi<{ unread: number }>("/portal/messages/unread-count")]);
  return (
    <PortalShell givenName={me.patient.givenName} unreadMessages={unread} signOut={signOut}>
      {children}
    </PortalShell>
  );
}
