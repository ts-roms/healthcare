import type { ManualHit } from "@healthcare/ui/primitives";
import { moduleTabsForPermissions } from "./module-tabs";
import { navigationForPermissions } from "./navigation";
import { settingsForPermissions } from "./settings-navigation";

/**
 * The command bar (Ctrl+K; docs/domains/assistant.md, "Command bar"): a typed phrase such as "book Reyes tomorrow",
 * "lab verify" or "appointments friday" turned into the screens and patient actions it may mean, by fixed word lists —
 * no model, nothing learned. It offers only what the person may open (the navigation's permissions and each page's own
 * check) and changes nothing: every item is a link. Patients are found through the ordinary patient search, which the API
 * audits like any other search.
 */

export interface CommandScreen {
  label: string;
  href: string;
  /** More words that find the screen ("cashier" for Billing). */
  keywords: string[];
  /** The screen shows a day: a date in the phrase opens that day (`?date=`). */
  dated?: boolean;
}

/** A patient as the command bar lists one: never more than the patient search's minimal fields. */
export interface CommandPatient {
  id: string;
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
  status: string;
}

export type CommandGroup = "Patients" | "Screens" | "Help" | "Search";

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  detail?: string;
  href: string;
}

export interface ParsedCommand {
  /** The meaningful words, lower case: no date, no filler words. Action words stay (they also name screens). */
  words: string[];
  /** The patient action the phrase starts or ends with, if any. */
  verb: PatientVerbKey | null;
  /** YYYY-MM-DD, when the phrase names a day. */
  date: string | null;
  /** What may name a patient (not an action, a day, a filler or a screen word), as typed; empty when there is none. */
  patientQuery: string;
}

// ---- patient actions -------------------------------------------------------------------------------------------------

interface PatientVerb {
  key: string;
  /** Word sequences that mean it, lower case. */
  phrases: ReadonlyArray<readonly string[]>;
  label: string;
  /** All of these are needed (the page's own check). */
  permissions: readonly string[];
  href: (patientId: string, date: string | null) => string;
}

export const PATIENT_VERBS = [
  {
    key: "book",
    phrases: [["book"], ["schedule"], ["appointment"], ["appt"], ["iskedyul"]],
    label: "Book an appointment",
    permissions: ["appointment.manage"],
    href: (id: string, date: string | null) => `/appointments/new?patientId=${id}${date ? `&date=${date}` : ""}`,
  },
  {
    key: "checkin",
    phrases: [["check", "in"], ["check-in"], ["checkin"], ["walk", "in"], ["walk-in"], ["walkin"]],
    label: "Check in as a walk-in",
    permissions: ["clinic.queue.manage"],
    href: (id: string) => `/queue/walk-in?patientId=${id}`,
  },
  {
    key: "bill",
    phrases: [["bill"], ["billing"], ["charge"], ["charges"], ["invoice"], ["invoices"], ["pay"], ["payment"], ["bayad"]],
    label: "Open billing",
    permissions: ["billing.charge.read"],
    href: (id: string) => `/billing/patients/${id}`,
  },
  {
    key: "labs",
    phrases: [["lab"], ["labs"], ["laboratory"], ["result"], ["results"]],
    label: "See lab results",
    permissions: ["patient.read", "lab.result.read"],
    href: (id: string) => `/patients/${id}?tab=labs`,
  },
  {
    key: "visits",
    phrases: [["visits"], ["consultations"], ["encounters"]],
    label: "See visits",
    permissions: ["patient.read"],
    href: (id: string) => `/patients/${id}?tab=visits`,
  },
  {
    key: "360",
    phrases: [["360"], ["summary"], ["workspace"]],
    label: "Open Patient 360",
    permissions: ["patient.read"],
    href: (id: string) => `/patients/${id}/360`,
  },
  {
    key: "timeline",
    phrases: [["timeline"], ["activity"]],
    label: "Open the timeline",
    permissions: ["patient.read"],
    href: (id: string) => `/patients/${id}/timeline`,
  },
  {
    key: "history",
    phrases: [["history"], ["kasaysayan"]],
    label: "Open the health history",
    permissions: ["patient.read", "history.read"],
    href: (id: string) => `/patients/${id}/history`,
  },
  {
    key: "vaccines",
    phrases: [["vaccine"], ["vaccines"], ["immunization"], ["immunizations"], ["bakuna"]],
    label: "Open immunizations",
    permissions: ["patient.read", "immunization.read"],
    href: (id: string) => `/patients/${id}/immunizations`,
  },
  {
    key: "edit",
    phrases: [["edit"], ["update"]],
    label: "Edit details",
    permissions: ["patient.update"],
    href: (id: string) => `/patients/${id}/edit`,
  },
  {
    key: "messages",
    phrases: [["communications"], ["texts"], ["sms"]],
    label: "See messages sent",
    permissions: ["notification.read"],
    href: (id: string) => `/patients/${id}/communications`,
  },
  {
    key: "dental",
    phrases: [["dental"], ["teeth"], ["tooth"], ["odontogram"], ["ngipin"]],
    label: "Open the dental record",
    permissions: ["dental.record.read"],
    href: (id: string) => `/dental/patients/${id}`,
  },
  {
    key: "coverage",
    phrases: [["coverage"], ["philhealth"], ["hmo"], ["insurance"]],
    label: "See coverage",
    permissions: ["patient.read"],
    href: (id: string) => `/patients/${id}?tab=coverage`,
  },
  {
    key: "open",
    phrases: [["open"], ["record"], ["chart"], ["patient"], ["pasyente"], ["view"]],
    label: "Open the record",
    permissions: ["patient.read"],
    href: (id: string) => `/patients/${id}`,
  },
] as const satisfies readonly PatientVerb[];

export type PatientVerbKey = (typeof PATIENT_VERBS)[number]["key"];

const OPEN_RECORD: PatientVerb = PATIENT_VERBS.find((v) => v.key === "open")!;

// ---- screens -----------------------------------------------------------------------------------------------------

/** More words per screen, English and a few Filipino. */
const KEYWORDS: Record<string, string[]> = {
  "/": ["home", "dashboard"],
  "/queue": ["line", "waiting", "pila", "board"],
  "/appointments": ["schedule", "bookings", "appts"],
  "/calendar": ["events", "meetings"],
  "/patients": ["search", "find", "pasyente"],
  "/messages": ["inbox", "conversations", "chat"],
  "/clinic/encounters": ["consult", "consults", "encounter", "encounters", "konsulta"],
  "/laboratory": ["lab", "labs"],
  "/laboratory/worklist": ["lab", "workbench"],
  "/billing": ["cashier", "bayad", "payments"],
  "/pharmacy": ["dispense", "dispensing", "medicines", "gamot"],
  "/inventory": ["stock", "supplies"],
  "/communications": ["sms", "texts", "emails", "sent"],
  "/admin": ["settings", "configuration", "setup"],
};

/** Screens that show a day, so "appointments friday" opens Friday. */
const DATED = new Set(["/appointments", "/calendar", "/appointments/new"]);

/** Screens the navigation does not list, each behind its page's own permission (none: everyone signed in). */
const EXTRAS: Array<CommandScreen & { permissions: string[] }> = [
  { label: "Register a new patient", href: "/patients/new", keywords: ["new", "register", "registration"], permissions: ["patient.register"] },
  { label: "Check in a walk-in", href: "/queue/walk-in", keywords: ["walkin", "checkin"], permissions: ["clinic.queue.manage"] },
  { label: "Book an appointment", href: "/appointments/new", keywords: ["book", "new"], permissions: ["appointment.manage"] },
  { label: "Lab worklist · Collect", href: "/laboratory/worklist?stage=collect", keywords: ["specimens", "collection"], permissions: ["lab.specimen.collect"] },
  { label: "Lab worklist · Receive", href: "/laboratory/worklist?stage=receive", keywords: ["specimens"], permissions: ["lab.specimen.receive"] },
  { label: "Lab worklist · Enter results", href: "/laboratory/worklist?stage=enter", keywords: ["entry"], permissions: ["lab.result.enter"] },
  { label: "Lab worklist · Verify", href: "/laboratory/worklist?stage=verify", keywords: [], permissions: ["lab.result.verify"] },
  { label: "Lab worklist · Approve", href: "/laboratory/worklist?stage=approve", keywords: [], permissions: ["lab.result.approve"] },
  { label: "Lab worklist · Release", href: "/laboratory/worklist?stage=release", keywords: [], permissions: ["lab.result.release"] },
  { label: "Stock low or out", href: "/inventory?show=low", keywords: ["low", "reorder"], permissions: ["inventory.read"] },
  { label: "Stock expiring", href: "/inventory?show=expiring", keywords: ["expiry", "expiring", "expired"], permissions: ["inventory.read"] },
  { label: "Waiting-room display", href: "/display/queue", keywords: ["tv", "screen"], permissions: ["clinic.queue.display"] },
  { label: "My account", href: "/account", keywords: ["password", "profile", "mfa"], permissions: [] },
  { label: "Notifications", href: "/notifications", keywords: ["bell", "alerts"], permissions: [] },
  { label: "Help", href: "/help", keywords: ["manual", "guide", "tulong"], permissions: [] },
];

/**
 * Every screen the person may open: the navigation, each module's tabs, the Settings pages and the extras above. The
 * first label wins when two entries open the same address.
 */
export function commandScreens(permissions: readonly string[], options: { platformAdmin?: boolean } = {}): CommandScreen[] {
  const granted = new Set(permissions);
  const out: CommandScreen[] = [];
  const seen = new Set<string>();
  const add = (screen: CommandScreen) => {
    if (seen.has(screen.href)) return;
    seen.add(screen.href);
    out.push(screen);
  };
  const screen = (label: string, href: string, extra: string[] = []): CommandScreen => ({
    label,
    href,
    keywords: [...extra, ...(KEYWORDS[href] ?? [])],
    ...(DATED.has(href) ? { dated: true } : {}),
  });
  for (const item of navigationForPermissions(permissions, undefined, options)) add(screen(item.label, item.href));
  for (const tab of moduleTabsForPermissions(permissions)) add(screen(`${tab.module} · ${tab.label}`, tab.href));
  for (const group of settingsForPermissions(permissions)) for (const page of group.pages) add(screen(`Settings · ${page.label}`, page.href, ["settings"]));
  for (const extra of EXTRAS) if (extra.permissions.every((p) => granted.has(p))) add(screen(extra.label, extra.href, extra.keywords));
  return out;
}

// ---- words and days ----------------------------------------------------------------------------------------------

/** Words that carry no meaning in a command, English and Filipino. */
const FILLERS = new Set([
  "a",
  "an",
  "the",
  "for",
  "on",
  "to",
  "of",
  "and",
  "in",
  "at",
  "with",
  "me",
  "my",
  "please",
  "pls",
  "sa",
  "ng",
  "ni",
  "si",
  "kay",
  "ang",
  "mga",
  "po",
]);

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  enero: 1,
  feb: 2,
  february: 2,
  pebrero: 2,
  mar: 3,
  march: 3,
  marso: 3,
  apr: 4,
  april: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  hunyo: 6,
  jul: 7,
  july: 7,
  hulyo: 7,
  aug: 8,
  august: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  setyembre: 9,
  oct: 10,
  october: 10,
  oktubre: 10,
  nov: 11,
  november: 11,
  nobyembre: 11,
  dec: 12,
  december: 12,
  disyembre: 12,
};

const RELATIVE: Record<string, number> = { today: 0, ngayon: 0, tomorrow: 1, bukas: 1, yesterday: -1, kahapon: -1 };

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** The words of a phrase, lower case, punctuation trimmed from their ends (inner hyphens kept: "walk-in", 2026-11-25). */
function tokenize(text: string): Array<{ word: string; typed: string }> {
  return text
    .split(/[\s,]+/)
    .map((typed) => ({ typed: typed.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""), word: "" }))
    .map((t) => ({
      ...t,
      word: t.typed
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    }))
    .filter((t) => t.word.length > 0);
}

/** Finds and removes the first day the words name, relative to `today` (the facility's). */
function takeDate(tokens: Array<{ word: string; typed: string }>, today: string): { date: string | null; rest: Array<{ word: string; typed: string }> } {
  const year = Number(today.slice(0, 4));
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]!.word;
    const remove = (count: number, date: string | null) => ({ date, rest: [...tokens.slice(0, i), ...tokens.slice(i + count)] });
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
      const [y, m, d] = w.split("-").map(Number) as [number, number, number];
      const date = validDate(y, m, d);
      if (date) return remove(1, date);
    }
    if (w in RELATIVE) return remove(1, shiftDays(today, RELATIVE[w]!));
    if (w in WEEKDAYS) {
      const current = new Date(`${today}T00:00:00Z`).getUTCDay();
      return remove(1, shiftDays(today, (WEEKDAYS[w]! - current + 7) % 7));
    }
    // "nov 25", "nov 25 2026", "25 nov", "25 nov 2026"
    const next = tokens[i + 1]?.word;
    const after = tokens[i + 2]?.word;
    const yearOf = (word: string | undefined) => (word && /^\d{4}$/.test(word) ? Number(word) : null);
    if (w in MONTHS && next && /^\d{1,2}$/.test(next)) {
      const y = yearOf(after);
      const date = validDate(y ?? year, MONTHS[w]!, Number(next));
      if (date) return remove(y ? 3 : 2, date);
    }
    if (/^\d{1,2}$/.test(w) && next && next in MONTHS) {
      const y = yearOf(after);
      const date = validDate(y ?? year, MONTHS[next]!, Number(w));
      if (date) return remove(y ? 3 : 2, date);
    }
  }
  return { date: null, rest: tokens };
}

/** The patient action at the start (preferred) or end of the words, and the words without it (and without the same action at the other end). */
function takeVerb(words: string[]): { verb: PatientVerbKey | null; start: number; end: number } {
  const startsWith = (phrase: readonly string[]) => phrase.every((p, i) => words[i] === p);
  const endsWith = (phrase: readonly string[]) => words.length > phrase.length && phrase.every((p, i) => words[words.length - phrase.length + i] === p);
  const byLength = PATIENT_VERBS.flatMap((v) => v.phrases.map((phrase) => ({ key: v.key, phrase }))).sort((a, b) => b.phrase.length - a.phrase.length);
  const atStart = byLength.find((c) => startsWith(c.phrase));
  if (atStart) {
    const tail = byLength.find((c) => c.key === atStart.key && words.length > atStart.phrase.length + c.phrase.length - 1 && endsWith(c.phrase));
    return { verb: atStart.key, start: atStart.phrase.length, end: words.length - (tail ? tail.phrase.length : 0) };
  }
  const atEnd = byLength.find((c) => endsWith(c.phrase));
  return atEnd ? { verb: atEnd.key, start: 0, end: words.length - atEnd.phrase.length } : { verb: null, start: 0, end: words.length };
}

function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !FILLERS.has(w));
}

function screenWords(screen: CommandScreen): string[] {
  return [...labelWords(screen.label), ...screen.keywords.flatMap(labelWords)];
}

/** A typed word finds a screen word when equal, or as its beginning from three letters ("lab" → "laboratory"). */
function finds(word: string, screenWord: string): boolean {
  return screenWord === word || (word.length >= 3 && screenWord.startsWith(word));
}

/** Whether a typed word is about screens rather than a name: equal to a screen word, or its beginning from four letters. */
function isScreenWord(word: string, screens: readonly CommandScreen[]): boolean {
  return screens.some((s) => screenWords(s).some((sw) => sw === word || (word.length >= 4 && sw.startsWith(word))));
}

/** Reads a phrase; `today` is the facility's local date (YYYY-MM-DD). */
export function parseCommand(text: string, today: string, screens: readonly CommandScreen[]): ParsedCommand {
  const { date, rest } = takeDate(tokenize(text), today);
  const { verb, start, end } = takeVerb(rest.map((t) => t.word));
  const words = rest.map((t) => t.word).filter((w) => !FILLERS.has(w));
  const nameWords = rest.slice(start, end).filter((t) => !FILLERS.has(t.word) && !isScreenWord(t.word, screens));
  return { words, verb, date, patientQuery: nameWords.map((t) => t.typed).join(" ") };
}

/** The screens the words find, best first: the most words found, then a label starting with the first word, then the shorter label. */
export function rankScreens(words: readonly string[], screens: readonly CommandScreen[], limit = 6): CommandScreen[] {
  if (words.length === 0) return [];
  return screens
    .map((screen, index) => {
      const own = screenWords(screen);
      const score = words.filter((w) => own.some((sw) => finds(w, sw))).length;
      const leads = labelWords(screen.label)[0]?.startsWith(words[0]!) ?? false;
      return { screen, index, score, leads };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.leads) - Number(a.leads) || a.screen.label.length - b.screen.label.length || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.screen);
}

function withDate(href: string, date: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}date=${date}`;
}

function patientDetail(p: CommandPatient): string {
  const sex = p.sex === "male" ? "M" : p.sex === "female" ? "F" : "";
  return [p.patientNumber, `${p.age}${sex ? ` ${sex}` : ""}`, p.status !== "active" ? p.status : ""].filter(Boolean).join(" · ");
}

const MAX_ITEMS = 12;

/**
 * What the command bar lists for a phrase: patients (with the action named, else "Open the record"), the screens the
 * words find (on the day named, when the screen shows one), a few help sections, and a full patient search. Patients
 * come first when an action was named, screens otherwise. Only what the permissions allow; every item is a link.
 */
export function commandItems(
  parsed: ParsedCommand,
  context: { screens: readonly CommandScreen[]; patients: readonly CommandPatient[]; help: readonly ManualHit[]; permissions: readonly string[] },
): CommandItem[] {
  const granted = new Set(context.permissions);
  const allowed = (permissions: readonly string[]) => permissions.every((p) => granted.has(p));
  const named = parsed.verb ? PATIENT_VERBS.find((v) => v.key === parsed.verb)! : null;
  const action: PatientVerb | null = named && allowed(named.permissions) ? named : allowed(OPEN_RECORD.permissions) ? OPEN_RECORD : null;

  const patients: CommandItem[] = action
    ? context.patients.map((p) => ({
        id: `patient:${p.id}`,
        group: "Patients" as const,
        label: `${action.label}: ${p.displayName}`,
        detail: patientDetail(p),
        href: action.href(p.id, parsed.date),
      }))
    : [];

  // A day alone ("tomorrow") opens the screens that show a day.
  const found = parsed.words.length ? rankScreens(parsed.words, context.screens) : parsed.date ? context.screens.filter((s) => s.dated) : [];
  const screens: CommandItem[] = found.map((s) => ({
    id: `screen:${s.href}`,
    group: "Screens" as const,
    label: s.label,
    ...(parsed.date && s.dated ? { detail: `for ${parsed.date}`, href: withDate(s.href, parsed.date) } : { href: s.href }),
  }));

  const help: CommandItem[] = context.help.map((h) => ({
    id: `help:${h.href}`,
    group: "Help" as const,
    label: h.heading,
    detail: h.chapterTitle,
    href: h.href,
  }));

  const search: CommandItem[] =
    parsed.patientQuery && granted.has("patient.search")
      ? [
          {
            id: "search:patients",
            group: "Search",
            label: `Search patients for “${parsed.patientQuery}”`,
            href: `/patients?q=${encodeURIComponent(parsed.patientQuery)}`,
          },
        ]
      : [];

  const ordered = named ? [...patients, ...screens, ...help, ...search] : [...screens, ...patients, ...help, ...search];
  return ordered.slice(0, MAX_ITEMS);
}
