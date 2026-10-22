"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { realtimeTicket } from "@/app/(portal)/actions";

/** While the socket is down the page re-reads every few seconds; while it is up, only as a safety net now and then. */
const POLL_MS = 10_000;
const SAFETY_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 300;
const RECONNECT_MS = 15_000;

/**
 * Keeps a conversation or the message list current while it is open and visible. The browser opens the realtime socket
 * with a short-lived ticket from the portal server and re-reads the page when the clinic's reply arrives (the message
 * says only which conversation changed). Without the socket, or for someone acting for another person (whose
 * conversations are not on the account holder's channel), the page re-reads every few seconds. Typed text is kept.
 */
export function LiveRefresh() {
  const router = useRouter();
  const live = React.useRef(false);
  const [, setLive] = React.useState(false);

  React.useEffect(() => {
    let socket: Socket | null = null;
    let stopped = false;
    let refreshTimer: number | undefined;
    let retryTimer: number | undefined;

    const refreshSoon = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };
    const setStatus = (value: boolean) => {
      live.current = value;
      setLive(value);
    };
    const retryLater = () => {
      setStatus(false);
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void start(), RECONNECT_MS);
    };

    async function start() {
      if (stopped) return;
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
            cb({ patientTicket: ticket });
            ticket = null;
            return;
          }
          realtimeTicket()
            .then((r) => cb(r.ok ? { patientTicket: r.data.ticket } : {}))
            .catch(() => cb({}));
        },
      });
      socket.on("ready", () => {
        setStatus(true);
        // Catch up on anything missed while disconnected.
        refreshSoon();
      });
      socket.on("messages.updated", refreshSoon);
      // Socket.IO reconnects by itself after network loss; a refusal by the server ends the socket, so retry later.
      socket.on("disconnect", (reason) => (reason === "io server disconnect" ? retryLater() : setStatus(false)));
      socket.on("connect_error", () => setStatus(false));
    }

    void start();

    let lastRefresh = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh < (live.current ? SAFETY_MS : POLL_MS) - 500) return;
      lastRefresh = Date.now();
      router.refresh();
    }, 2_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(retryTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [router]);

  return null;
}
