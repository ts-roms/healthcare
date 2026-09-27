import type { Metadata } from "next";
import { Toaster } from "@healthcare/ui/primitives";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Healthcare Platform", template: "%s · Healthcare Platform" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
