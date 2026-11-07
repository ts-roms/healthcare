"use client";

import { KioskFailure } from "@/components/kiosk-message";
import "./globals.css";

/** The last resort: the root layout itself failed, so this page brings its own document. */
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <KioskFailure retry={unstable_retry} />
      </body>
    </html>
  );
}
