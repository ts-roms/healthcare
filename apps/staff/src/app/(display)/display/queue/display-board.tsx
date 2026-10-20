"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, BellRingIcon, MaximizeIcon, Play, UsersIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, ToggleGroup, ToggleGroupItem } from "@healthcare/ui/primitives";
import { LiveIndicator, useQueueUpdates } from "@/components/live-queue";
import type { QueueDisplay } from "@/lib/api/types";
import {
  announcements,
  currentCallKey,
  DEFAULT_SOUND_SETTINGS,
  type DisplaySoundSettings,
  parseSoundSettings,
  shouldChime,
  SOUND_LEVEL_GAIN,
  SOUND_SETTINGS_KEY,
  type SoundLevel,
  type VoiceLanguage,
} from "@/lib/queue-display";
import { canSpeak, playChime, speak, stopSpeaking } from "@/lib/queue-display-sound";

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
  const [current, ...earlier] = display?.calls ?? [];
  const sound = useDisplaySound(currentCallKey(display), current ?? null);
  useWakeLock();

  const time = (iso: string | Date) => new Intl.DateTimeFormat("en-PH", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const today = new Intl.DateTimeFormat("en-PH", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);

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
          <SoundMenu sound={sound} />
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
        <Button variant="outline" size="sm" aria-pressed={sound.on}>
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

/**
 * The chime (and, when chosen, the spoken call) whenever the call shown changes. Off until someone turns it on at the
 * screen (browsers only play sound after a click there); never on the first render. Volume and voice are kept in this
 * browser's storage, so the screen keeps them across reloads; whether sound is on is not — it needs the click.
 */
function useDisplaySound(callKey: string | null, current: { ticket: string; calledTo: string } | null): DisplaySound {
  const [on, setOn] = React.useState(false);
  const [settings, setSettings] = React.useState<DisplaySoundSettings>(DEFAULT_SOUND_SETTINGS);
  const [speechAvailable, setSpeechAvailable] = React.useState(false);
  const audio = React.useRef<AudioContext | null>(null);
  const previous = React.useRef<string | null | undefined>(undefined);
  const speakTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef({ settings, current });
  latest.current = { settings, current };

  // Read after mount: the server render knows nothing of this screen's storage.
  React.useEffect(() => {
    try {
      setSettings(parseSoundSettings(window.localStorage.getItem(SOUND_SETTINGS_KEY)));
    } catch {
      // Private window or storage blocked: the defaults, for this page load.
    }
    setSpeechAvailable(canSpeak());
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
    setSettings(next);
    try {
      window.localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Kept for this page load only.
    }
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
