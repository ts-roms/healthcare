import type { PortalPreference, PreferenceCategory, PreferenceChannel } from "./api/types";

export const PREFERENCE_CHANNELS: readonly PreferenceChannel[] = ["sms", "email", "push"];
export const CHANNEL_TEXT: Record<PreferenceChannel, string> = { sms: "Text message", email: "Email", push: "Notification on your phone or computer" };

/** The channels to show: push only where the clinic can send it. */
export function channelsShown(pushConfigured: boolean): readonly PreferenceChannel[] {
  return pushConfigured ? PREFERENCE_CHANNELS : PREFERENCE_CHANNELS.filter((c) => c !== "push");
}

/** The kinds of message, in the patient's words. */
export const CATEGORY_TEXT: Record<PreferenceCategory, { title: string; about: string }> = {
  clinical: {
    title: "About your care",
    about:
      "Results ready to view, and reminders about follow-up care and medicines. Switching these off means you may not hear that something needs your attention.",
  },
  administrative: {
    title: "Appointments and bills",
    about: "Booking confirmations, reminders and changes, and notices about invoices and payments.",
  },
  outreach: {
    title: "Check-in reminders",
    about: "Optional reminders from the clinic, such as being due for a check-up. Off unless you turn them on.",
  },
};

export const CATEGORY_ORDER: readonly PreferenceCategory[] = ["clinical", "administrative", "outreach"];

export type Selection = Record<string, boolean>;
export const selectionKey = (channel: PreferenceChannel, category: PreferenceCategory) => `${channel}.${category}`;

/** What is switched on now, for each channel and kind of message. */
export function selectionOf(preferences: readonly PortalPreference[]): Selection {
  return Object.fromEntries(preferences.map((p) => [selectionKey(p.channel, p.category), p.enabled]));
}

/** The choices that differ from what is saved: only these are sent. */
export function changedChoices(saved: Selection, next: Selection): Array<{ channel: PreferenceChannel; category: PreferenceCategory; optedIn: boolean }> {
  const changes: Array<{ channel: PreferenceChannel; category: PreferenceCategory; optedIn: boolean }> = [];
  for (const channel of PREFERENCE_CHANNELS) {
    for (const category of CATEGORY_ORDER) {
      const key = selectionKey(channel, category);
      if (next[key] !== undefined && next[key] !== saved[key]) changes.push({ channel, category, optedIn: next[key] });
    }
  }
  return changes;
}

/** Care messages switched off on every channel the clinic can reach the patient on: worth a warning before saving. */
export function careMessagesOff(next: Selection, channels: readonly PreferenceChannel[] = PREFERENCE_CHANNELS): boolean {
  return channels.every((channel) => next[selectionKey(channel, "clinical")] === false);
}
