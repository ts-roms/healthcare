"use client";

import { useRef, useState } from "react";
import { checkIn } from "@/app/actions";
import type { IssuedTicket } from "@/lib/flow";
import { newKey } from "./bits";

/**
 * Check in for an appointment or a walk-in service. Each target keeps one idempotency key for the whole session, so a
 * second tap or a retry after a dropped connection returns the ticket already issued instead of a second one.
 */
export function useCheckIn(onTicket: (ticket: IssuedTicket) => void, onSessionOver: () => void) {
  const keys = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(target: { appointmentId: string } | { visitTypeId: string }, service: string) {
    const id = "appointmentId" in target ? target.appointmentId : target.visitTypeId;
    let key = keys.current.get(id);
    if (!key) keys.current.set(id, (key = newKey()));
    setBusyId(id);
    setError(null);
    const result = await checkIn(target, key);
    setBusyId(null);
    if (result.ok) return onTicket({ ...result.data, service });
    if (result.code === "kiosk_session_expired") return onSessionOver();
    setError(result.message);
  }

  return { run, busyId, error };
}
