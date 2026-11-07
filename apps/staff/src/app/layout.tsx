import type { Metadata } from "next";
import { connection } from "next/server";
import { Toaster } from "@healthcare/ui/primitives";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Healthcare Platform", template: "%s · Healthcare Platform" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request: each page carries its own script nonce (Content Security Policy, proxy.ts), which a page
  // prerendered at build time could not.
  await connection();
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
