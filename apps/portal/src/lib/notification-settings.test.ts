import { describe, expect, it } from "vitest";
import type { PortalPreference } from "./api/types";
import { careMessagesOff, changedChoices, selectionOf } from "./notification-settings";

const pref = (channel: "sms" | "email", category: "clinical" | "administrative" | "outreach", enabled: boolean): PortalPreference => ({
  channel,
  category,
  choice: null,
  enabled,
  recordedVia: null,
  updatedAt: null,
});
const all = [
  pref("sms", "clinical", true),
  pref("sms", "administrative", true),
  pref("sms", "outreach", false),
  pref("email", "clinical", true),
  pref("email", "administrative", true),
  pref("email", "outreach", false),
];

describe("notification settings", () => {
  it("sends only the choices that changed", () => {
    const saved = selectionOf(all);
    expect(changedChoices(saved, saved)).toEqual([]);
    expect(changedChoices(saved, { ...saved, "sms.outreach": true, "email.clinical": false })).toEqual([
      { channel: "sms", category: "outreach", optedIn: true },
      { channel: "email", category: "clinical", optedIn: false },
    ]);
  });

  it("warns only when care messages are off on every channel", () => {
    const saved = selectionOf(all);
    expect(careMessagesOff(saved)).toBe(false);
    expect(careMessagesOff({ ...saved, "sms.clinical": false })).toBe(false);
    expect(careMessagesOff({ ...saved, "sms.clinical": false, "email.clinical": false })).toBe(true);
  });
});
