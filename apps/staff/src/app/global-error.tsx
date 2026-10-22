"use client";

import { RotateCcwIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";
import "./globals.css";

/** The last resort: the root layout itself failed, so this page brings its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-dvh place-items-center bg-background p-4">
          <ErrorState
            as="h1"
            title="The app could not be loaded"
            description="Something went wrong while starting the page. Try again; if it keeps happening, tell your administrator."
            reference={error.digest}
            actions={
              <Button size="sm" onClick={() => retry()}>
                <RotateCcwIcon /> Try again
              </Button>
            }
          />
        </main>
      </body>
    </html>
  );
}
