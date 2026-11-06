import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Toaster } from "@healthcare/ui/primitives";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MyHealth", template: "%s · MyHealth" },
  description: "Book visits, see results and talk to your care team.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request: each page carries its own script nonce (Content Security Policy, proxy.ts), which a page
  // prerendered at build time could not.
  await connection();
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
