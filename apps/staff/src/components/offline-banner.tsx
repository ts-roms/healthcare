"use client";

import * as React from "react";
import { WifiOffIcon } from "lucide-react";
import { COUNT_SLOT, pendingCount } from "@/lib/offline/store";

/**
 * Registers the service worker that keeps the Offline page reachable, and shows a banner while the browser has no
 * connection or while captured actions wait to be replayed (ADR-0013). A full navigation, not a client-side one:
 * the service worker answers it from its cache when the network is down.
 */
function subscribe(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === COUNT_SLOT) callback();
  };
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener("healthcare-offline-changed", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("healthcare-offline-changed", callback);
  };
}

export function OfflineBanner() {
  const online = React.useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const pending = React.useSyncExternalStore(subscribe, pendingCount, () => 0);

  React.useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  if (online && pending === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-warning bg-warning-subtle px-4 py-2 text-table text-warning-foreground">
      <WifiOffIcon className="size-4" aria-hidden />
      {online ? (
        <span>
          {pending} offline action{pending === 1 ? "" : "s"} waiting to be sent.
        </span>
      ) : (
        <span>No connection. Registration, walk-in check-in and vital signs can be captured and sent when the connection returns.</span>
      )}
      {/* A full navigation on purpose: the service worker answers it from its cache when the network is down. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/offline" className="font-medium text-primary underline-offset-4 hover:underline">
        Open the Offline page
      </a>
    </div>
  );
}
