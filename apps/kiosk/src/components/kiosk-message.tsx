"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { endSession } from "@/app/actions";
import { BigButton } from "./bits";

/** How long an unattended kiosk waits before it tries again on its own. */
export const RETRY_AFTER_MS = 15_000;

/**
 * What a patient sees when the kiosk itself fails: plain words, no technical detail, and the front desk. The kiosk ends
 * whatever session was open (so nothing of the last person stays on the server's side of the screen) and tries again by
 * itself, so it recovers when the connection does without anyone restarting it.
 */
export function KioskFailure({ retry }: { retry: () => void }) {
  useEffect(() => {
    void endSession().catch(() => undefined);
    const timer = setTimeout(retry, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [retry]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-primary-subtle p-10 text-center" role="alert">
      <TriangleAlertIcon aria-hidden className="size-20 text-warning" />
      <h1 className="text-5xl font-semibold">This kiosk cannot help right now</h1>
      <p className="max-w-2xl text-3xl">Please check in at the front desk. We are sorry for the trouble.</p>
      <BigButton onClick={retry}>Try again</BigButton>
    </main>
  );
}
