"use client";

import { HeartPulseIcon } from "lucide-react";
import { BigButton } from "../bits";
import { Notice } from "../frame";

export type WelcomeProps = {
  facilityName: string;
  /** Why the kiosk cannot serve anyone right now, if it cannot. */
  outOfService: string | null;
  error: string | null;
  starting: boolean;
  onStart: () => void;
};

/** KioskWelcomePage: one big target. Touching it starts a session; until then nothing about anyone is on screen. */
export function KioskWelcomePage({ facilityName, outOfService, error, starting, onStart }: WelcomeProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-primary-subtle p-10 text-center">
      <HeartPulseIcon aria-hidden className="size-24 text-primary" />
      <div className="flex flex-col gap-3">
        <h1 className="text-6xl leading-tight font-semibold text-primary-deep">Welcome</h1>
        <p className="text-3xl text-foreground">{facilityName}</p>
      </div>
      {outOfService ? (
        <Notice tone="info">{outOfService}</Notice>
      ) : (
        <BigButton onClick={onStart} disabled={starting} className="min-h-24 px-16 text-4xl">
          {starting ? "One moment…" : "Touch here to check in"}
        </BigButton>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-xl text-muted-foreground">If you need help, please ask the front desk.</p>
    </main>
  );
}
