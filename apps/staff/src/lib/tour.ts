/**
 * The guided tours of the staff app: short spotlight walk-throughs of the main areas, one for the whole app and one per
 * module or screen (the content is in `tour-steps.ts`).
 *
 * Tours are a per-browser preference (nothing clinical, nothing sent to the API): `enabled` is the personal switch on My
 * account (on by default), `seen` remembers which version of each tour this browser finished or skipped, so a tour starts by
 * itself once — the first time its screen is opened — and then only on request. The organization can switch every tour off
 * (`GET /organization/tour-setting`); that is decided by `StaffShell`, which then does not mount the overlay at all.
 */
export const TOUR_ENABLED_KEY = "hp.tour.enabled";
/** JSON `{ [tourId]: version }`. (Before page tours the value was a bare number for the app tour; it reads as that tour seen.) */
export const TOUR_SEEN_KEY = "hp.tour.seen";
/** Fired on `window` to start a tour now; `detail` is `{ id?: string }` (no id = the tour of the current screen, else the app tour). */
export const TOUR_START_EVENT = "hp:tour-start";
/** Fired on `window` when the switch or what was seen changes, so open components re-read it. */
export const TOUR_CHANGE_EVENT = "hp:tour-change";
export const WELCOME_TOUR_ID = "welcome";

export interface TourStep {
  title: string;
  body: string;
  /** CSS selector of the element to highlight; the step is shown centred when it is missing or hidden (e.g. on a phone). */
  target?: string;
  /** A screen this step is about: shown as a link that ends the tour and opens it. */
  link?: { href: string; label: string };
}

export interface TourDef {
  id: string;
  title: string;
  description: string;
  /** Bump when the steps change enough to be worth showing again. */
  version: number;
  /** Where it starts by itself on the first visit; omit for a tour that only runs on request. */
  matches?: (pathname: string) => boolean;
  /** Permission needed to see it listed (any one of); omit for everyone. */
  permissions?: string[];
  steps: TourStep[];
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked (private window): the tours then simply start again next time.
  }
  window.dispatchEvent(new Event(TOUR_CHANGE_EVENT));
}

/** On unless someone turned it off. */
export function isTourEnabled(): boolean {
  return read(TOUR_ENABLED_KEY) !== "off";
}

export function setTourEnabled(enabled: boolean) {
  write(TOUR_ENABLED_KEY, enabled ? "on" : "off");
}

export function parseSeen(raw: string | null): Record<string, number> {
  if (!raw) return {};
  if (/^\d+$/.test(raw)) return Number(raw) > 0 ? { [WELCOME_TOUR_ID]: Number(raw) } : {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}

export function hasSeenTour(tour: Pick<TourDef, "id" | "version">): boolean {
  return (parseSeen(read(TOUR_SEEN_KEY))[tour.id] ?? 0) >= tour.version;
}

export function markTourSeen(tour: Pick<TourDef, "id" | "version">) {
  write(TOUR_SEEN_KEY, JSON.stringify({ ...parseSeen(read(TOUR_SEEN_KEY)), [tour.id]: tour.version }));
}

/** Show every tour again on its first visit. */
export function resetTourSeen() {
  write(TOUR_SEEN_KEY, "{}");
}

/** The tour of this screen: the most specific one (the last in `tours` that matches), if any. */
export function tourForPath(tours: readonly TourDef[], pathname: string): TourDef | undefined {
  return [...tours].reverse().find((t) => t.id !== WELCOME_TOUR_ID && t.matches?.(pathname));
}

/** The tour that should start by itself on this screen: the app tour first, then the screen's own, each once. */
export function tourToAutoStart(tours: readonly TourDef[], pathname: string): TourDef | undefined {
  if (!isTourEnabled()) return undefined;
  const welcome = tours.find((t) => t.id === WELCOME_TOUR_ID);
  if (welcome && !hasSeenTour(welcome)) return welcome;
  const own = tourForPath(tours, pathname);
  return own && !hasSeenTour(own) ? own : undefined;
}

/** Whether a path is exactly `base` or inside it. */
export function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const norm = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * The elements a selector names. Beyond CSS (no screen carries tour-specific attributes), a selector may be written as
 *   `card:Title`    the card whose title is exactly "Title"
 *   `section:Title` the nearest section/form around a heading (h2, h3) with exactly that text
 *   `button:Text`   a button or link whose text starts with "Text"
 * and `||` separates alternatives, tried in order.
 */
export function queryTarget(selector: string, root: Document = document): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const part of selector.split("||").map((p) => p.trim())) {
    const text = part.slice(part.indexOf(":") + 1);
    if (part.startsWith("card:")) {
      for (const title of Array.from(root.querySelectorAll<HTMLElement>('[data-slot="card-title"]'))) {
        if (norm(title.textContent) === text) found.push(title.closest<HTMLElement>('[data-slot="card"]') ?? title);
      }
    } else if (part.startsWith("section:")) {
      for (const heading of Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))) {
        if (norm(heading.textContent) === text) found.push(heading.closest<HTMLElement>("section, form, aside") ?? heading);
      }
    } else if (part.startsWith("button:")) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, a"))) {
        if (norm(el.textContent).startsWith(text)) found.push(el);
      }
    } else {
      try {
        found.push(...Array.from(root.querySelectorAll<HTMLElement>(part)));
      } catch {
        // A selector that is not valid CSS names nothing.
      }
    }
  }
  return found;
}

/**
 * The on-screen box of an element: its own, or for a `display: contents` wrapper (which has none) the box around its visible
 * children. Null when nothing of it is visible.
 */
export function boxOf(el: HTMLElement): DOMRect | null {
  const own = el.getBoundingClientRect();
  if (own.width > 0 && own.height > 0) return own;
  if (getComputedStyle(el).display !== "contents") return null;
  let box: DOMRect | null = null;
  for (const child of Array.from(el.children)) {
    const r = child instanceof HTMLElement ? boxOf(child) : null;
    if (!r) continue;
    box = box
      ? new DOMRect(
          Math.min(box.left, r.left),
          Math.min(box.top, r.top),
          Math.max(box.right, r.right) - Math.min(box.left, r.left),
          Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top),
        )
      : r;
  }
  return box;
}

/** The element a step points at and its box, if it is on screen now (a hidden or missing one is shown as a centred card). */
export function resolveTarget(step: TourStep, root: Document = document): { el: HTMLElement; rect: DOMRect } | null {
  if (!step.target) return null;
  for (const el of queryTarget(step.target, root)) {
    const rect = boxOf(el);
    if (rect) return { el, rect };
  }
  return null;
}
