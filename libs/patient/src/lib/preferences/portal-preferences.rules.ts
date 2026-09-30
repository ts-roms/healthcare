import { COMMUNICATION_CATEGORIES, type CommunicationCategory, type CommunicationChannel } from "../patient.schema";

/**
 * What a patient may choose in MyHealth. Text messages, email and push (to the devices they allowed in their browser)
 * are the patient's to switch on and off for each kind of message. In-app messages are the MyHealth inbox itself
 * (ending them means withdrawing MyHealth), so they are not offered. Where the clinic contacts the patient by SMS or
 * email (the number or address on the record) stays a clinic change, so the record stays accurate.
 */
export const PORTAL_PREFERENCE_CHANNELS = ["sms", "email", "push"] as const satisfies readonly CommunicationChannel[];
export type PortalPreferenceChannel = (typeof PORTAL_PREFERENCE_CHANNELS)[number];
export const PORTAL_PREFERENCE_CATEGORIES = COMMUNICATION_CATEGORIES;

export function isPortalPreferenceChannel(channel: string): channel is PortalPreferenceChannel {
  return (PORTAL_PREFERENCE_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Whether a kind of message is sent when the patient has made no choice: care-related ones are, outreach needs an
 * explicit opt-in (mirrors resolvePatientContact).
 */
export function defaultOptedIn(category: CommunicationCategory): boolean {
  return category !== "outreach";
}

/** A short hint of where a message would go, so the patient can recognise it without the full number or address being repeated. */
export function maskDestination(channel: Exclude<PortalPreferenceChannel, "push">, value: string | undefined): string | null {
  if (!value) return null;
  if (channel === "sms") return value.length > 4 ? `•••• ${value.slice(-4)}` : "••••";
  const at = value.lastIndexOf("@");
  if (at < 1) return "••••";
  return `${value[0]}•••${value.slice(at)}`;
}

/** Where push reaches the patient: how many devices allowed it (none when they have not turned it on anywhere). */
export function describePushDevices(count: number): string | null {
  return count > 0 ? `${count} ${count === 1 ? "device" : "devices"}` : null;
}
