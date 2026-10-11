"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, BellRingIcon, MaximizeIcon, UsersIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { LiveIndicator, useQueueUpdates } from "@/components/live-queue";
import type { QueueDisplay } from "@/lib/api/types";
import { currentCallKey, shouldChime } from "@/lib/queue-display";

/**
 * The waiting-room display: the ticket being called now and where to go, the tickets called before it, and how many
 * wait. Kept current by the live queue socket (polling every 15 s when it is down). Never a patient detail.
 */
export function DisplayBoard({
  display,
  facilityName,
  timeZone,
  canLeave,
}: {
  display: QueueDisplay | null;
  facilityName: string;
  timeZone: string;
  canLeave: boolean;
}) {
  const [now, setNow] = React.useState(() => new Date());
  const status = useQueueUpdates(() => setNow(new Date()));
  const sound = useChime(currentCallKey(display));
  useWakeLock();

  const time = (iso: string | Date) => new Intl.DateTimeFormat("en-PH", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const today = new Intl.DateTimeFormat("en-PH", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  const [current, ...earlier] = display?.calls ?? [];

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold sm:text-3xl">{facilityName}</h1>
          <p className="text-body text-muted-foreground sm:text-lg">
            {today} · {time(now)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator status={status} />
          <Button variant="outline" size="sm" onClick={sound.toggle} aria-pressed={sound.on}>
            {sound.on ? <Volume2Icon /> : <VolumeXIcon />} {sound.on ? "Sound on" : "Turn on sound"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>
            <MaximizeIcon /> Full screen
          </Button>
          {canLeave ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/queue">Back to the queue</Link>
            </Button>
          ) : null}
        </div>
      </header>

      {display === null ? (
        <main className="flex flex-1 items-center justify-center rounded-lg border bg-card p-8 text-center">
          <p className="text-section text-muted-foreground sm:text-2xl">Reconnecting… This screen will update by itself.</p>
        </main>
      ) : (
        <main className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section aria-labelledby="now-calling" className="flex flex-col justify-center rounded-lg border bg-card p-6 text-center sm:p-10">
            <h2 id="now-calling" className="flex items-center justify-center gap-2 text-section font-medium text-muted-foreground sm:text-3xl">
              <BellRingIcon className="size-6 sm:size-8" aria-hidden /> Now calling
            </h2>
            <div aria-live="polite" aria-atomic="true">
              {current ? (
                <>
                  <p className="mt-4 text-[min(22vw,10rem)] leading-none font-bold tabular-nums">{current.ticket}</p>
                  <p className="mt-4 flex items-center justify-center gap-3 text-[min(9vw,3.5rem)] leading-tight font-semibold text-primary">
                    <ArrowRightIcon className="size-[0.8em] shrink-0" aria-hidden />
                    <span className="sr-only">Please go to</span>
                    {current.calledTo}
                  </p>
                  <p className="mt-3 text-body text-muted-foreground sm:text-lg">Called at {time(current.calledAt)}</p>
                </>
              ) : (
                <p className="mt-6 text-section text-muted-foreground sm:text-3xl">Please wait for your number to be called.</p>
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <section aria-labelledby="recently-called" className="flex-1 rounded-lg border bg-card p-4 sm:p-6">
              <h2 id="recently-called" className="text-section font-medium text-muted-foreground sm:text-2xl">
                Recently called
              </h2>
              {earlier.length ? (
                <ul className="mt-3 divide-y">
                  {earlier.map((call) => (
                    <li key={`${call.ticket}-${call.calledAt}`} className="flex items-baseline justify-between gap-3 py-2 sm:py-3">
                      <span className="text-2xl font-bold tabular-nums sm:text-4xl">{call.ticket}</span>
                      <span className="text-right">
                        <span className="block text-section font-semibold sm:text-2xl">{call.calledTo}</span>
                        <span className="text-meta text-muted-foreground sm:text-body">{time(call.calledAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-body text-muted-foreground sm:text-lg">No one else called yet today.</p>
              )}
            </section>
            <section aria-label="Waiting" className="flex items-center gap-3 rounded-lg border bg-card p-4 sm:p-6">
              <UsersIcon className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-section sm:text-2xl">
                <span className="font-bold tabular-nums">{display.waiting}</span> waiting
              </p>
            </section>
          </aside>
        </main>
      )}
    </div>
  );
}

/**
 * A short two-tone chime when the call shown changes. Off until someone turns it on at the screen (browsers only play
 * sound after a click there); never on the first render.
 */
function useChime(callKey: string | null): { on: boolean; toggle: () => void } {
  const [on, setOn] = React.useState(false);
  const audio = React.useRef<AudioContext | null>(null);
  const previous = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (on && audio.current && shouldChime(previous.current, callKey)) playChime(audio.current);
    previous.current = callKey;
  }, [callKey, on]);

  const toggle = () => {
    if (!on) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      playChime(audio.current);
    }
    setOn(!on);
  };
  return { on, toggle };
}

function playChime(context: AudioContext) {
  const start = context.currentTime;
  [660, 880].forEach((frequency, i) => {
    const at = start + i * 0.35;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.65);
  });
}

/** Keeps the screen from sleeping while the display is shown (where the browser supports it). */
function useWakeLock() {
  React.useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          lock = sentinel;
        })
        .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}
