"use client";

import * as React from "react";
import { TimerIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@healthcare/ui/primitives";
import { signOut } from "@/app/(staff)/actions";
import { idleState } from "@/lib/idle";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "touchstart"];
const TICK_MS = 1000;

/**
 * Signs the browser out after `minutes` without activity, with a one-minute warning the person can dismiss by staying.
 * Shared clinic computers are the reason: a record left open on a counter is read by whoever walks up next. Activity
 * in any tab of this origin counts (the last activity is shared through localStorage), so a second tab does not sign
 * the first one out.
 */
export function IdleSignOut({ minutes }: { minutes: number }) {
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);
  // Set by the effect below (reading the clock during render is impure).
  const lastActivity = React.useRef(0);
  const signingOut = React.useRef(false);

  React.useEffect(() => {
    if (minutes <= 0) return;
    const KEY = "hc_staff_last_activity";
    const touch = () => {
      lastActivity.current = Date.now();
      try {
        localStorage.setItem(KEY, String(lastActivity.current));
      } catch {
        // Private windows may refuse storage; this tab's own clock still applies.
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) lastActivity.current = Math.max(lastActivity.current, Number(e.newValue));
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, touch, { passive: true });
    window.addEventListener("storage", onStorage);
    touch();
    const timer = setInterval(() => {
      const { state, secondsLeft: left } = idleState(lastActivity.current, Date.now(), minutes);
      if (state === "expired") {
        if (!signingOut.current) {
          signingOut.current = true;
          void signOut();
        }
        return;
      }
      setSecondsLeft(state === "warning" ? left : null);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, touch);
      window.removeEventListener("storage", onStorage);
    };
  }, [minutes]);

  if (minutes <= 0 || secondsLeft === null) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && setSecondsLeft(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TimerIcon className="size-4" aria-hidden /> Still there?
          </DialogTitle>
          <DialogDescription>
            You will be signed out in {secondsLeft} second{secondsLeft === 1 ? "" : "s"} because nothing was done for a while, so no patient record is left open
            on a shared computer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            autoFocus
            onClick={() => {
              lastActivity.current = Date.now();
              setSecondsLeft(null);
            }}
          >
            Stay signed in
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
