/**
 * The waiting-room display's sounds, in the browser only: a bell-like chime drawn with Web Audio (no audio file to
 * load, works offline) and the spoken announcement through the browser's speech synthesis (the voices installed on
 * the screen's device; nothing leaves the device). Pure rules — what is said, how loud — are in `queue-display.ts`.
 */

/** The chime: a descending "ding-dong" (E5 → C5), each note a few partials with a bell's quick attack and long decay. */
const NOTES: ReadonlyArray<{ frequency: number; at: number }> = [
  { frequency: 659.25, at: 0 },
  { frequency: 523.25, at: 0.45 },
];
const PARTIALS: ReadonlyArray<{ ratio: number; gain: number }> = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.35 },
  { ratio: 3, gain: 0.12 },
];
const ATTACK = 0.012;
const DECAY = 1.4;
/** Peak gain of one note at full level, under the master gain. */
const NOTE_GAIN = 0.22;

/** Plays the chime at the level given (0–1) and returns how long it sounds, in seconds. */
export function playChime(context: AudioContext, level: number): number {
  const start = context.currentTime + 0.02;
  const master = context.createGain();
  master.gain.value = Math.max(0, Math.min(1, level));
  master.connect(context.destination);
  for (const note of NOTES) {
    const at = start + note.at;
    for (const partial of PARTIALS) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency * partial.ratio;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(NOTE_GAIN * partial.gain, at + ATTACK);
      // Higher partials die away sooner, as on a real bell.
      gain.gain.exponentialRampToValueAtTime(0.0001, at + DECAY / partial.ratio);
      oscillator.connect(gain).connect(master);
      oscillator.start(at);
      oscillator.stop(at + DECAY + 0.05);
    }
  }
  return Math.max(...NOTES.map((note) => note.at)) + DECAY;
}

/** Whether this browser can read a call out. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
}

/** The installed voice that fits a language best: the exact tag, then the same language, else the browser's choice. */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const wanted = lang.toLowerCase();
  const language = wanted.split("-")[0] ?? wanted;
  // Filipino voices are tagged fil or tl depending on the platform.
  const aliases = language === "fil" ? ["fil", "tl"] : [language];
  return (
    voices.find((v) => v.lang.toLowerCase() === wanted) ??
    voices.find((v) => aliases.some((a) => v.lang.toLowerCase().startsWith(`${a}-`) || v.lang.toLowerCase() === a))
  );
}

/**
 * Reads one announcement's lines out one after the other at the volume given (0-1) and says whether it worked. It never cuts
 * off what is being said: the display's playback queue (announcement-queue.ts) decides the order, so a call is read after
 * the one before it. False when this browser cannot speak, a voice errors, or nothing finishes in time (no voice installed,
 * the speech service stuck) — the screen then says that announcements are not working.
 */
export function speakLines(lines: ReadonlyArray<{ lang: string; text: string }>, volume: number): Promise<boolean> {
  if (lines.length === 0) return Promise.resolve(true);
  if (!canSpeak()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let remaining = lines.length;
    let failed = false;
    const guard = setTimeout(
      () => {
        failed = true;
        window.speechSynthesis.cancel();
        resolve(false);
      },
      8_000 + lines.length * 6_000,
    );
    const settle = () => {
      remaining -= 1;
      if (remaining > 0) return;
      clearTimeout(guard);
      resolve(!failed);
    };
    for (const line of lines) {
      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = line.lang;
      const voice = voiceFor(line.lang);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.9;
      utterance.volume = Math.max(0, Math.min(1, volume));
      utterance.onend = settle;
      utterance.onerror = () => {
        failed = true;
        settle();
      };
      window.speechSynthesis.speak(utterance);
    }
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
