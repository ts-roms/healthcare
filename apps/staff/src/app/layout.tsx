import type { Metadata } from "next";
import { Toaster } from "@healthcare/ui/primitives";
import { StaffShell } from "@/components/staff-shell";
import { getRole } from "@/lib/role";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Healthcare Platform", template: "%s · Healthcare Platform" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  return (
    <html lang="en">
      <body>
        <StaffShell role={role}>{children}</StaffShell>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
