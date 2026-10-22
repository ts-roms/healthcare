"use client";

import Link from "next/link";
import { HomeIcon, RotateCcwIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

/** A MyHealth page failed to render. The menu stays; only the reference is shown, never the technical message. */
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorState
      as="h1"
      title="We couldn't show this page"
      description="Something went wrong on our side. Your records are safe. Try again, or go back to your home page. For anything urgent, contact your clinic."
      reference={error.digest}
      actions={
        <>
          <Button onClick={() => retry()}>
            <RotateCcwIcon /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <HomeIcon /> Home
            </Link>
          </Button>
        </>
      }
    />
  );
}
