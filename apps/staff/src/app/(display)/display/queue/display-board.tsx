"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  BellRingIcon,
  ClockIcon,
  MaximizeIcon,
  Play,
  RadioIcon,
  RefreshCwIcon,
  UsersIcon,
  Volume2Icon,
  VolumeXIcon,
  WifiOffIcon,
} from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";
import { Button, Popover, PopoverContent, PopoverTrigger, ToggleGroup, ToggleGroupItem } from "@healthcare/ui/primitives";
import { useQueueUpdates } from "@/components/live-queue";
import type { LiveStatus } from "@/lib/live-queue";
import type { QueueDisplay } from "@/lib/api/types";
import {
  announcements,
  CALL_HIGHLIGHT_MS,
  callAnnouncement,
  currentCallKey,
  displayStatusLabel,
  type DisplaySoundSettings,
  parseSoundSettings,
  RECENT_CALLS_SHOWN,
  shouldChime,
  SOUND_LEVEL_GAIN,
  SOUND_SETTINGS_KEY,
  type SoundLevel,
  type VoiceLanguage,
} from "@/lib/queue-display";
import { canSpeak, playChime, speak, stopSpeaking } from "@/lib/queue-display-sound";

/**
 * The waiting-room display: the ticket being served now and where to go, the tickets called before it, and how many
 * wait. Kept current by the live queue socket (polling every 15 s when it is down). Never a patient detail, and never
 * the order of those waiting (priority would make it appear to jump).
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
  const [current, ...earlier] = display?.calls ?? [];
  const callKey = currentCallKey(display);
  const sound = useDisplaySound(callKey, current ?? null);
  const highlighted = useCallHighlight(callKey);
  useWakeLock();

  // The clock moves on the minute's scale, not every second (the queue's own updates refresh it too).
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const time = (iso: string | Date) => new Intl.DateTimeFormat("en-PH", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const today = new Intl.DateTimeFormat("en-PH", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);
  const recent = earlier.slice(0, RECENT_CALLS_SHOWN);

  return (
    <div className="queue-display bg-qd-bg text-qd-text flex h-dvh min-h-[40rem] flex-col gap-7 overflow-hidden px-12 py-10">
      <header className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-qd-ink truncate text-[clamp(28px,2.3vw,44px)] leading-tight font-semibold">{facilityName}</h1>
          <p className="text-qd-muted text-[clamp(16px,1.15vw,22px)]">{today}</p>
        </div>
        <div className="flex shrink-0 items-center gap-6">
          <div className="flex items-center gap-2">
            <SoundMenu sound={sound} />
            <Button
              variant="outline"
              className="border-qd-border bg-qd-card text-qd-ink size-11 rounded-full p-0"
              aria-label="Full screen"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
            >
              <MaximizeIcon aria-hidden />
            </Button>
            {canLeave ? (
              <Button asChild variant="outline" className="border-qd-border bg-qd-card text-qd-ink h-11 rounded-full px-5">
                <Link href="/queue">Back to the queue</Link>
              </Button>
            ) : null}
          </div>
          <div className="border-qd-divider border-l pl-6 text-right">
            <p className="text-qd-ink text-[clamp(32px,2.7vw,52px)] leading-none font-semibold tabular-nums">{time(now)}</p>
            <ConnectionStatus status={status} />
          </div>
        </div>
      </header>

      {display === null ? (
        <main className="border-qd-border bg-qd-card flex flex-1 items-center justify-center rounded-xl border-2 p-8 text-center">
          <p className="text-qd-muted text-[clamp(22px,2vw,36px)]">Reconnecting… This screen will update by itself.</p>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 gap-7 lg:grid-cols-[1.7fr_1fr]">
          <section
            aria-labelledby="now-serving"
            className={cn(
              "bg-qd-card flex min-h-0 flex-col rounded-xl border-2 p-10",
              highlighted ? "qd-call-highlight border-qd-accent" : "border-qd-border",
            )}
          >
            <h2 id="now-serving" className="text-qd-muted flex items-center gap-3 text-[clamp(20px,1.6vw,30px)] font-semibold tracking-wide uppercase">
              <BellRingIcon className="size-[1.1em]" aria-hidden /> {current ? "Now serving" : "First number to be called"}
            </h2>
            {current ? (
              <>
                <p className="text-qd-accent flex-1 content-center text-[clamp(150px,15.6vw,300px)] leading-none font-semibold tracking-tighter tabular-nums">
                  {current.ticket}
                </p>
                <div className="border-qd-divider flex items-end justify-between gap-6 border-t pt-6">
                  <div className="min-w-0">
                    <p className="text-qd-muted text-[clamp(18px,1.6vw,30px)]">Please proceed to</p>
                    <p className="text-qd-accent flex items-center gap-4 text-[clamp(48px,5vw,96px)] leading-tight font-semibold break-words">
                      <ArrowRightIcon className="size-[0.8em] shrink-0" aria-hidden />
                      {current.calledTo}
                    </p>
                  </div>
                  <p className="text-qd-muted shrink-0 pb-2 text-[clamp(16px,1.15vw,22px)] tabular-nums">Called at {time(current.calledAt)}</p>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col justify-center gap-4">
                <p className="text-qd-accent text-[clamp(56px,6vw,120px)] leading-tight font-semibold">Please have a seat</p>
                <p className="text-qd-muted max-w-[28ch] text-[clamp(22px,2vw,36px)] leading-snug">Your number and counter will appear here, with a chime.</p>
              </div>
            )}
          </section>

          <aside className="flex min-h-0 flex-col gap-7">
            <section aria-labelledby="recently-called" className="border-qd-border bg-qd-card flex min-h-0 flex-1 flex-col rounded-xl border-2 p-8">
              <h2 id="recently-called" className="text-qd-ink text-[clamp(20px,1.6vw,30px)] font-semibold">
                Recently called
              </h2>
              {recent.length ? (
                <ul className="divide-qd-divider mt-4 divide-y">
                  {recent.map((call) => (
                    <li key={`${call.ticket}-${call.calledAt}`} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-5 py-3">
                      <span className="text-qd-ink text-[clamp(24px,1.8vw,34px)] font-semibold tabular-nums">{call.ticket}</span>
                      <span className="truncate text-[clamp(16px,1.25vw,24px)]">{call.calledTo}</span>
                      <span className="text-qd-muted text-[clamp(14px,1.05vw,20px)] tabular-nums">{time(call.calledAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-qd-muted flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <ClockIcon className="size-12" aria-hidden />
                  <p className="text-[clamp(16px,1.25vw,24px)]">No numbers called yet today</p>
                </div>
              )}
            </section>
            <section aria-label="Waiting" className="border-qd-border bg-qd-card flex items-center gap-5 rounded-xl border-2 p-8">
              <UsersIcon className="text-qd-muted size-12 shrink-0" aria-hidden />
              <p className="text-qd-muted flex items-baseline gap-3 text-[clamp(18px,1.6vw,30px)]">
                <span className="text-qd-ink text-[clamp(48px,3.8vw,72px)] leading-none font-semibold tabular-nums">{display.waiting}</span> waiting
              </p>
            </section>
          </aside>
        </main>
      )}

      <footer className="text-qd-muted text-center text-[clamp(16px,1.25vw,24px)]">Please keep your ticket and ID ready.</footer>

      {/* New calls are announced to screen readers; the visual call is not repeated here. */}
      <p className="sr-only" aria-live="assertive" aria-atomic="true">
        {current ? callAnnouncement(current) : ""}
      </p>
    </div>
  );
}

/** Connection text with its own icon (a dropped feed never changes only a colour). */
function ConnectionStatus({ status }: { status: LiveStatus }) {
  const Icon = status === "live" ? RadioIcon : status === "connecting" ? RefreshCwIcon : WifiOffIcon;
  return (
    <p
      role="status"
      className={cn("mt-1 inline-flex items-center gap-2 text-[clamp(14px,1.05vw,20px)] font-medium", status === "live" ? "text-qd-live-text" : "text-qd-ink")}
    >
      {status === "live" ? <span className="bg-qd-live-dot size-2.5 rounded-full" aria-hidden /> : null}
      <Icon className={cn("size-[1em]", status === "connecting" && "motion-safe:animate-spin")} aria-hidden />
      {displayStatusLabel(status)}
    </p>
  );
}

/** True for a few seconds after a new call replaces the one shown (not on the page's first render). */
function useCallHighlight(callKey: string | null): boolean {
  const [highlighted, setHighlighted] = React.useState(false);
  const previous = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const changed = previous.current !== undefined && callKey !== null && callKey !== previous.current;
    previous.current = callKey;
    if (!changed) return;
    // Starting the highlight is the point of this effect: a new call arrived from the live feed.
    setHighlighted(true);
    const timer = setTimeout(() => setHighlighted(false), CALL_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [callKey]);
  return highlighted;
}

interface DisplaySound {
  on: boolean;
  settings: DisplaySoundSettings;
  speechAvailable: boolean;
  toggle: () => void;
  setLevel: (level: SoundLevel) => void;
  setVoice: (voice: VoiceLanguage) => void;
  test: () => void;
}

/** The sound controls: on/off, how loud, whether the call is read out, and a test of what the screen will do. */
function SoundMenu({ sound }: { sound: DisplaySound }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="border-qd-border bg-qd-card text-qd-ink h-11 rounded-full px-5" aria-pressed={sound.on}>
          {sound.on ? <Volume2Icon /> : <VolumeXIcon />} {sound.on ? "Sound on" : "Sound off"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-1">
          <p className="text-body font-medium">Sound</p>
          <p className="text-meta text-muted-foreground">A chime when a ticket is called. Browsers play sound only after a click on this screen.</p>
          <Button variant={sound.on ? "outline" : "default"} size="sm" onClick={sound.toggle} aria-pressed={sound.on}>
            {sound.on ? <VolumeXIcon /> : <Volume2Icon />} {sound.on ? "Turn off sound" : "Turn on sound"}
          </Button>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-body font-medium">Volume</legend>
          <ToggleGroup type="single" value={sound.settings.level} onValueChange={(value) => value && sound.setLevel(value as SoundLevel)} aria-label="Volume">
            <ToggleGroupItem value="quiet">Quiet</ToggleGroupItem>
            <ToggleGroupItem value="normal">Normal</ToggleGroupItem>
            <ToggleGroupItem value="loud">Loud</ToggleGroupItem>
          </ToggleGroup>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-body font-medium">Read the call out</legend>
          <ToggleGroup
            type="single"
            value={sound.settings.voice}
            onValueChange={(value) => value && sound.setVoice(value as VoiceLanguage)}
            aria-label="Read the call out"
            disabled={!sound.speechAvailable}
          >
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="en">English</ToggleGroupItem>
            <ToggleGroupItem value="fil">Filipino</ToggleGroupItem>
            <ToggleGroupItem value="both">Both</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-meta text-muted-foreground">
            {sound.speechAvailable
              ? "After the chime: “Number A 0 0 7, please proceed to Room 2”, with the voices installed on this device (a Filipino voice is not available everywhere)."
              : "This browser cannot read text out."}
          </p>
        </fieldset>
        <Button variant="outline" size="sm" onClick={sound.test} disabled={!sound.on}>
          <Play /> Test
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ---- this browser's sound settings as an external store ---------------------------------------------------------------

const soundSettingsListeners = new Set<() => void>();
/** Settings kept for this page load when storage is blocked (private window). */
let memorySettings: string | null = null;

function subscribeToSoundSettings(listener: () => void): () => void {
  soundSettingsListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    soundSettingsListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function notifySoundSettings(): void {
  for (const listener of soundSettingsListeners) listener();
}

/** The stored settings text (a string, so equal values are the same snapshot); null when nothing is stored or storage is blocked. */
function readStoredSoundSettings(): string | null {
  try {
    return window.localStorage.getItem(SOUND_SETTINGS_KEY) ?? memorySettings;
  } catch {
    return memorySettings;
  }
}

const subscribeNever = () => () => undefined;

/**
 * The chime (and, when chosen, the spoken call) whenever the call shown changes. Off until someone turns it on at the
 * screen (browsers only play sound after a click there); never on the first render. Volume and voice are kept in this
 * browser's storage, so the screen keeps them across reloads; whether sound is on is not — it needs the click.
 */
function useDisplaySound(callKey: string | null, current: { ticket: string; calledTo: string } | null): DisplaySound {
  const [on, setOn] = React.useState(false);
  // Read from this browser's storage without a render-then-effect round trip: the server render (and hydration) use the defaults.
  const storedSettings = React.useSyncExternalStore(subscribeToSoundSettings, readStoredSoundSettings, () => null);
  const settings = React.useMemo(() => parseSoundSettings(storedSettings), [storedSettings]);
  const speechAvailable = React.useSyncExternalStore(subscribeNever, canSpeak, () => false);
  const audio = React.useRef<AudioContext | null>(null);
  const previous = React.useRef<string | null | undefined>(undefined);
  const speakTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef({ settings, current });
  // Refs are written after the render commits, never during it.
  React.useEffect(() => {
    latest.current = { settings, current };
  });

  React.useEffect(() => {
    // Chrome loads voices after the first ask; asking now has them ready for the first announcement.
    if (canSpeak()) window.speechSynthesis.getVoices();
    return () => {
      if (speakTimer.current) clearTimeout(speakTimer.current);
      stopSpeaking();
    };
  }, []);

  const play = React.useCallback((call: { ticket: string; calledTo: string } | null) => {
    const context = audio.current;
    if (!context) return;
    const { settings: now } = latest.current;
    const gain = SOUND_LEVEL_GAIN[now.level];
    const seconds = playChime(context, gain);
    if (speakTimer.current) clearTimeout(speakTimer.current);
    stopSpeaking();
    const lines = call ? announcements(call, now.voice) : [];
    if (lines.length) speakTimer.current = setTimeout(() => speak(lines, gain), seconds * 1000 - 400);
  }, []);

  React.useEffect(() => {
    // The call read out is the one the key names: it changes together with the key.
    if (on && shouldChime(previous.current, callKey)) play(latest.current.current);
    previous.current = callKey;
  }, [callKey, on, play]);

  const save = (next: DisplaySoundSettings) => {
    try {
      window.localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: kept for this page load only.
      memorySettings = JSON.stringify(next);
    }
    notifySoundSettings();
  };

  return {
    on,
    settings,
    speechAvailable,
    toggle: () => {
      if (!on) {
        audio.current ??= new AudioContext();
        void audio.current.resume();
        play(null);
      } else {
        if (speakTimer.current) clearTimeout(speakTimer.current);
        stopSpeaking();
      }
      setOn(!on);
    },
    setLevel: (level) => save({ ...latest.current.settings, level }),
    setVoice: (voice) => save({ ...latest.current.settings, voice }),
    test: () => play(latest.current.current ?? { ticket: "A-001", calledTo: "Room 1" }),
  };
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
