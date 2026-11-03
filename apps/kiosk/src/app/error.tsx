"use client";

import { KioskFailure } from "@/components/kiosk-message";

/** A page failed to load (for example the API is down): a patient-readable screen that retries by itself. */
export default function KioskError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <KioskFailure retry={unstable_retry} />;
}
