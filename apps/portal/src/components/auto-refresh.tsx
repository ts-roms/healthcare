"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page current while it is open and visible: re-reads it every few seconds and when the tab
 * comes back to the front. Typed text and other client state stay as they are (only the server data is refreshed).
 * For pages without a live channel, such as a conversation waiting for the other side's reply.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, seconds]);
  return null;
}
