import { defaultOptedIn, describePushDevices, isPortalPreferenceChannel, maskDestination } from "./portal-preferences.rules";

describe("portal preference rules", () => {
  it("offers text messages, email and push, not the inbox", () => {
    expect(isPortalPreferenceChannel("sms")).toBe(true);
    expect(isPortalPreferenceChannel("email")).toBe(true);
    expect(isPortalPreferenceChannel("push")).toBe(true);
    expect(isPortalPreferenceChannel("in_app")).toBe(false);
  });

  it("says how many devices push reaches", () => {
    expect(describePushDevices(0)).toBeNull();
    expect(describePushDevices(1)).toBe("1 device");
    expect(describePushDevices(3)).toBe("3 devices");
  });

  it("defaults care messages on and outreach off", () => {
    expect(defaultOptedIn("clinical")).toBe(true);
    expect(defaultOptedIn("administrative")).toBe(true);
    expect(defaultOptedIn("outreach")).toBe(false);
  });

  it("masks destinations", () => {
    expect(maskDestination("sms", "+639171234567")).toBe("•••• 4567");
    expect(maskDestination("email", "juan@example.ph")).toBe("j•••@example.ph");
    expect(maskDestination("sms", undefined)).toBeNull();
  });
});
