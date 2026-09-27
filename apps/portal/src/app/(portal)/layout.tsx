import { PortalShell } from "@/components/portal-shell";
import { getMe } from "@/lib/api/session";
import { signOut } from "./actions";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <PortalShell givenName={me.patient.givenName} signOut={signOut}>
      {children}
    </PortalShell>
  );
}
