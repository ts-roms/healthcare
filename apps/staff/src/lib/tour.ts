/**
 * The guided tour of the staff app: a short walk through the screen's main areas for someone new.
 *
 * It is a per-browser preference (nothing clinical, nothing sent to the API): `enabled` is the Settings switch (on by default),
 * `seen` remembers which version of the tour this browser finished or skipped, so it starts by itself once and then only on request.
 */
export const TOUR_VERSION = 1;
export const TOUR_ENABLED_KEY = "hp.tour.enabled";
export const TOUR_SEEN_KEY = "hp.tour.seen";
/** Fired on `window` to start the tour now (Settings → Start the tour). */
export const TOUR_START_EVENT = "hp:tour-start";
/** Fired on `window` when the switch or the seen version changes, so open components re-read it. */
export const TOUR_CHANGE_EVENT = "hp:tour-change";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector of the element to highlight; the step is shown centred when it is missing or hidden (e.g. on a phone). */
  target?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: "This short tour shows where things are. It takes about a minute, and you can skip it at any time. Turn it off or start it again under Settings → Guided tour.",
  },
  {
    id: "navigation",
    title: "Your menu",
    body: "Everything you are allowed to use is listed here, grouped by area: patients, clinic, laboratory, billing and more. A number beside an item is work waiting for you.",
    target: 'nav[aria-label="Main"]',
  },
  {
    id: "search",
    title: "Find a patient",
    body: "Search by name, patient number or mobile number. Press / anywhere to jump to this box.",
    target: '[role="search"]',
  },
  {
    id: "facility",
    title: "Your facility",
    body: "Choose the clinic or laboratory you are working in. Queues, schedules and figures follow this choice.",
    target: '[aria-label="Facility"]',
  },
  {
    id: "notifications",
    title: "Notifications",
    body: "Messages for you appear here, such as critical results and requests that need an answer.",
    target: 'a[href="/notifications"]',
  },
  {
    id: "help",
    title: "Help is always close",
    body: "The help button opens the user manual, with the chapter about the screen you are on shown first.",
    target: '[aria-label="Open the user manual"], [aria-label="Help"]',
  },
  {
    id: "account",
    title: "Your account",
    body: "Change your password, set up two-step verification, find Settings or log out from here.",
    target: '[aria-label="Account menu"]',
  },
];

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
    // Storage may be blocked (private window): the tour then simply starts again next time.
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

export function hasSeenTour(): boolean {
  return Number(read(TOUR_SEEN_KEY) ?? 0) >= TOUR_VERSION;
}

export function markTourSeen() {
  write(TOUR_SEEN_KEY, String(TOUR_VERSION));
}

export function resetTourSeen() {
  write(TOUR_SEEN_KEY, "0");
}

/** Whether the tour should start by itself on this page load. */
export function shouldAutoStart(): boolean {
  return isTourEnabled() && !hasSeenTour();
}

/** The steps that can be drawn now: a step whose target is missing or not visible is kept but shown without a highlight. */
export function resolveTarget(step: TourStep, root: Document = document): HTMLElement | null {
  if (!step.target) return null;
  const candidates = root.querySelectorAll<HTMLElement>(step.target);
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}
