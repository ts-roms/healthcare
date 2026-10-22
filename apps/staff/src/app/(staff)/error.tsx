"use client";

import Link from "next/link";
import { HomeIcon, RotateCcwIcon } from "lucide-react";
import { Button, ErrorState } from "@healthcare/ui/primitives";

/**
 * A page of the staff app failed to render. The shell around it stays (navigation keeps working); the message is never
 * shown — only the reference the server logged it under.
 */
export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorState
      as="h1"
      title="This page could not be shown"
      description="Something went wrong on our side. Nothing you entered was lost on the server. Try again, or go back to the dashboard."
      reference={error.digest}
      actions={
        <>
          <Button size="sm" onClick={() => retry()}>
            <RotateCcwIcon /> Try again
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/">
              <HomeIcon /> Dashboard
            </Link>
          </Button>
        </>
      }
    />
  );
}
