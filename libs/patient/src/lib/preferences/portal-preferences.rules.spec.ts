import { defaultOptedIn, isPortalPreferenceChannel, maskDestination } from "./portal-preferences.rules";

describe("portal preference rules", () => {
  it("offers text messages and email only", () => {
    expect(isPortalPreferenceChannel("sms")).toBe(true);
    expect(isPortalPreferenceChannel("email")).toBe(true);
    expect(isPortalPreferenceChannel("push")).toBe(false);
    expect(isPortalPreferenceChannel("in_app")).toBe(false);
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
