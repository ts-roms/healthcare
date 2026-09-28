"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RadioIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react";
import type { Socket } from "socket.io-client";
import { realtimeTicket } from "@/app/(staff)/actions";
import { LIVE_REFRESH_DEBOUNCE_MS, type LiveStatus, liveStatusLabel, QUEUE_TICK_MS, RECONNECT_DELAY_MS, shouldPoll } from "@/lib/live-queue";

/** Socket messages that mean the queue changed. */
export const QUEUE_EVENTS = ["queue.updated"] as const;
/** Socket messages that mean the facility laboratory changed (sent only to users who may read laboratory orders). */
export const LAB_EVENTS = ["lab.updated"] as const;

/**
 * Live updates for the selected facility. Opens the API's realtime socket with
 * a short-lived ticket from the staff server (a fresh one for each connection
 * attempt) and refreshes the page's server data when one of `events` arrives.
 * Messages carry ids and statuses only; the refresh re-reads through the
 * authorized API. Callers keep polling as a fallback while not "live".
 */
export function useLiveUpdates(events: readonly string[], onRefresh?: () => void): LiveStatus {
  const router = useRouter();
  const [status, setStatus] = React.useState<LiveStatus>("connecting");
  const refreshed = React.useRef(onRefresh);
  React.useEffect(() => {
    refreshed.current = onRefresh;
  });

  const eventKey = events.join(",");

  React.useEffect(() => {
    const subscribed = eventKey.split(",").filter(Boolean);
    let socket: Socket | null = null;
    let stopped = false;
    let refreshTimer: number | undefined;
    let retryTimer: number | undefined;

    const refreshSoon = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshed.current?.();
        router.refresh();
      }, LIVE_REFRESH_DEBOUNCE_MS);
    };
    const retryLater = () => {
      setStatus("offline");
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void start(), RECONNECT_DELAY_MS);
    };

    async function start() {
      if (stopped) return;
      setStatus("connecting");
      const first = await realtimeTicket().catch(() => null);
      if (stopped) return;
      if (!first?.ok) return retryLater();
      const { io } = await import("socket.io-client");
      if (stopped) return;
      let ticket: string | null = first.data.ticket;
      socket?.close();
      socket = io(first.data.url, {
        transports: ["websocket"],
        // Tickets expire after 60 s: use the first one now, then fetch a fresh one for every reconnection.
        auth: (cb) => {
          if (ticket) {
            cb({ ticket });
            ticket = null;
            return;
          }
          realtimeTicket()
            .then((r) => cb(r.ok ? { ticket: r.data.ticket } : {}))
            .catch(() => cb({}));
        },
      });
      socket.on("ready", () => {
        setStatus("live");
        // Catch up on anything missed while disconnected.
        refreshSoon();
      });
      for (const event of subscribed) socket.on(event, refreshSoon);
      // Socket.IO reconnects by itself after network loss; a refusal by the server ends the socket, so retry later.
      socket.on("disconnect", (reason) => (reason === "io server disconnect" ? retryLater() : setStatus("connecting")));
      socket.on("connect_error", () => setStatus("offline"));
    }

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [router, eventKey]);

  return status;
}

/** Live queue updates (see useLiveUpdates). */
export function useLiveQueue(onRefresh?: () => void): LiveStatus {
  return useLiveUpdates(QUEUE_EVENTS, onRefresh);
}

/**
 * Keeps a screen current: live updates when the socket is up, polling
 * otherwise. `onTick` runs on every tick and every live refresh (e.g. to
 * advance waiting times and the "updated" time).
 */
export function useQueueUpdates(onTick?: () => void, events: readonly string[] = QUEUE_EVENTS): LiveStatus {
  const router = useRouter();
  const status = useLiveUpdates(events, onTick);
  const lastRefresh = React.useRef(0);
  const tick = React.useRef(onTick);
  React.useEffect(() => {
    tick.current = onTick;
  });

  React.useEffect(() => {
    lastRefresh.current = Date.now();
    const timer = window.setInterval(() => {
      tick.current?.();
      // Fetch fresh data only while the screen is visible.
      if (document.visibilityState !== "visible" || !shouldPoll(status, lastRefresh.current, Date.now())) return;
      lastRefresh.current = Date.now();
      router.refresh();
    }, QUEUE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [router, status]);

  return status;
}

/** Connection indicator: icon + text, never colour alone. */
export function LiveIndicator({ status }: { status: LiveStatus }) {
  const Icon = status === "live" ? RadioIcon : status === "connecting" ? RefreshCwIcon : WifiOffIcon;
  return (
    <span className={`inline-flex items-center gap-1 text-meta ${status === "live" ? "text-success-foreground" : "text-muted-foreground"}`} role="status">
      <Icon className="size-3.5" aria-hidden />
      {liveStatusLabel(status)}
    </span>
  );
}

/** For pages that show the queue without managing it (the dashboard): keeps it current and shows the indicator. */
export function LiveQueueRefresh({ events = QUEUE_EVENTS }: { events?: readonly string[] }) {
  return <LiveIndicator status={useQueueUpdates(undefined, events)} />;
}

/** Keeps a laboratory screen (worklists, critical results) current and shows the indicator. */
export function useLabUpdates(): LiveStatus {
  return useQueueUpdates(undefined, LAB_EVENTS);
}

/** Indicator + live refresh for server-rendered laboratory pages. */
export function LiveLabRefresh() {
  return <LiveIndicator status={useLabUpdates()} />;
}
