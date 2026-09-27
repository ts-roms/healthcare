"use client";

import * as React from "react";
import type { Slot } from "@/lib/booking";
import { loadSlots } from "./actions";

type Query = { facilityId: string; visitTypeId: string; date: string; practitionerId?: string };

/**
 * Open times for the chosen day, re-read whenever the choice changes (latest
 * request wins). `key` identifies the current choice, so a picked slot can be
 * dropped when the choice changes.
 */
export function useSlots(query: Query | null) {
  const [round, setRound] = React.useState(0);
  const key = query ? `${JSON.stringify(query)}#${round}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; slots: Slot[] } | null>(null);

  React.useEffect(() => {
    if (!key) return;
    let current = true;
    loadSlots(JSON.parse(key.slice(0, key.lastIndexOf("#"))) as Query).then((result) => {
      if (current) setLoaded({ key, slots: result.ok ? result.data.slots : [] });
    });
    return () => {
      current = false;
    };
  }, [key]);

  const fresh = loaded !== null && loaded.key === key;
  return { key, slots: fresh ? loaded.slots : null, loading: key !== null && !fresh, reload: () => setRound((r) => r + 1) };
}

/** A slot picked for one choice of day/doctor; forgotten when the choice changes. */
export function usePickedSlot(key: string | null) {
  const [picked, setPicked] = React.useState<{ key: string | null; slot: Slot } | null>(null);
  const slot = picked && picked.key === key ? picked.slot : null;
  return [slot, (next: Slot | null) => setPicked(next ? { key, slot: next } : null)] as const;
}
