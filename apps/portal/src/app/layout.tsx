import type { Metadata, Viewport } from "next";
import { Toaster } from "@healthcare/ui/primitives";
import { PortalShell } from "@/components/portal-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MyHealth", template: "%s · MyHealth" },
  description: "Book visits, see results and talk to your care team.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PortalShell>{children}</PortalShell>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
