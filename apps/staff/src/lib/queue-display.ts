import type { QueueDisplay } from "./api/types";

/** The permission of the waiting-room display (migration 0112). */
export const QUEUE_DISPLAY_PERMISSION = "clinic.queue.display";

/** A display account (role queue_display) holds nothing else: it lands on the display and never sees the staff app. */
export function isDisplayOnly(permissions: readonly string[]): boolean {
  return permissions.length > 0 && permissions.every((p) => p === QUEUE_DISPLAY_PERMISSION);
}

/** Identifies the call being shown now: a new value means someone was just called (or called again). */
export function currentCallKey(display: Pick<QueueDisplay, "calls"> | null): string | null {
  const call = display?.calls[0];
  return call ? `${call.ticket}|${call.calledTo}|${call.calledAt}` : null;
}

/** Whether to chime: the call shown now changed since the last render, and it is not the first render of the page. */
export function shouldChime(previousKey: string | null | undefined, currentKey: string | null): boolean {
  return previousKey !== undefined && currentKey !== null && currentKey !== previousKey;
}

/** How loud the display plays: a gain the chime and the spoken announcement share. */
export type SoundLevel = "quiet" | "normal" | "loud";
export const SOUND_LEVEL_GAIN: Record<SoundLevel, number> = { quiet: 0.3, normal: 0.65, loud: 1 };

/** Whether a call is also read out, and in which language(s); "both" says it in English, then in Filipino. */
export type VoiceLanguage = "off" | "en" | "fil" | "both";

/** The sound settings a screen keeps (browser storage, per screen); whether sound is on is never kept — a click turns it on. */
export interface DisplaySoundSettings {
  level: SoundLevel;
  voice: VoiceLanguage;
}
export const DEFAULT_SOUND_SETTINGS: DisplaySoundSettings = { level: "normal", voice: "off" };
export const SOUND_SETTINGS_KEY = "hc.queue-display.sound";

const LEVELS: readonly SoundLevel[] = ["quiet", "normal", "loud"];
const VOICES: readonly VoiceLanguage[] = ["off", "en", "fil", "both"];

/** Settings read back from storage; anything missing or unknown falls back to the default. */
export function parseSoundSettings(raw: string | null | undefined): DisplaySoundSettings {
  if (!raw) return DEFAULT_SOUND_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof DisplaySoundSettings, unknown>> | null;
    const level = LEVELS.find((l) => l === value?.level) ?? DEFAULT_SOUND_SETTINGS.level;
    const voice = VOICES.find((v) => v === value?.voice) ?? DEFAULT_SOUND_SETTINGS.voice;
    return { level, voice };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

/** A ticket read out character by character so that it is heard right: "A-007" → "A 0 0 7" (zero, zero, seven). */
export function spellTicket(ticket: string): string {
  return ticket
    .toUpperCase()
    .split("")
    .filter((c) => /[A-Z0-9]/.test(c))
    .join(" ");
}

/** What the display says for a call, in the order it says it; the place is read as staff typed it. */
export function announcements(call: { ticket: string; calledTo: string }, voice: VoiceLanguage): Array<{ lang: string; text: string }> {
  const ticket = spellTicket(call.ticket);
  const english = { lang: "en-PH", text: `Number ${ticket}, please proceed to ${call.calledTo}.` };
  const filipino = { lang: "fil-PH", text: `Numero ${ticket}, pumunta po sa ${call.calledTo}.` };
  switch (voice) {
    case "en":
      return [english];
    case "fil":
      return [filipino];
    case "both":
      return [english, filipino];
    default:
      return [];
  }
}

/** The display's connection text (always shown with an icon, never colour alone): what a patient in the room can rely on. */
export function displayStatusLabel(status: "connecting" | "live" | "offline"): string {
  return status === "live" ? "Live" : status === "connecting" ? "Reconnecting�" : "Offline";
}

/** How long the Now serving card stays highlighted after a new call. */
export const CALL_HIGHLIGHT_MS = 4_000;

/** The last calls the "Recently called" card lists (the one being served is shown on its own card). */
export const RECENT_CALLS_SHOWN = 4;

/** What a screen reader hears when a new ticket is called. */
export function callAnnouncement(call: { ticket: string; calledTo: string }): string {
  return `Ticket ${call.ticket}, please proceed to ${call.calledTo}`;
}
