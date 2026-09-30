import { type CommunicationFacts, resolvePatientContact } from "./communication-policy";

const base: CommunicationFacts = {
  status: "active",
  channel: "sms",
  category: "clinical",
  optedIn: undefined,
  primaryMobile: "+639171234567",
  primaryEmail: "juan@example.ph",
};

describe("resolvePatientContact", () => {
  it("allows care-related messages by default", () => {
    expect(resolvePatientContact(base)).toEqual({ allowed: true, destination: "+639171234567" });
    expect(resolvePatientContact({ ...base, channel: "email", category: "administrative" })).toEqual({
      allowed: true,
      destination: "juan@example.ph",
    });
  });

  it("requires explicit opt-in for outreach", () => {
    expect(resolvePatientContact({ ...base, category: "outreach" })).toEqual({ allowed: false, reason: "no_outreach_opt_in" });
    expect(resolvePatientContact({ ...base, category: "outreach", optedIn: true }).allowed).toBe(true);
  });

  it("honors opt-out even for clinical messages", () => {
    expect(resolvePatientContact({ ...base, optedIn: false })).toEqual({ allowed: false, reason: "opted_out" });
  });

  it("never contacts deceased or merged records", () => {
    expect(resolvePatientContact({ ...base, status: "deceased" })).toEqual({ allowed: false, reason: "patient_deceased" });
    expect(resolvePatientContact({ ...base, status: "merged" })).toEqual({ allowed: false, reason: "patient_merged" });
  });

  it("sends in-app messages only to patients with an active MyHealth account", () => {
    expect(resolvePatientContact({ ...base, channel: "in_app" })).toEqual({ allowed: false, reason: "no_portal_account" });
    expect(resolvePatientContact({ ...base, channel: "in_app", portalActive: true })).toEqual({ allowed: true, destination: null });
    expect(resolvePatientContact({ ...base, channel: "in_app", portalActive: true, optedIn: false }).allowed).toBe(false);
  });

  it("requires a destination on file", () => {
    expect(resolvePatientContact({ ...base, primaryMobile: undefined })).toEqual({ allowed: false, reason: "no_mobile_number" });
  });

  it("pushes to the MyHealth account that allowed it, under the same preferences", () => {
    const push = { ...base, channel: "push" as const };
    expect(resolvePatientContact(push)).toEqual({ allowed: false, reason: "no_push_device" });
    expect(resolvePatientContact({ ...push, pushAccountId: "acct-1" })).toEqual({ allowed: true, destination: "acct-1" });
    expect(resolvePatientContact({ ...push, pushAccountId: "acct-1", optedIn: false })).toEqual({ allowed: false, reason: "opted_out" });
    expect(resolvePatientContact({ ...push, pushAccountId: "acct-1", category: "outreach" })).toEqual({ allowed: false, reason: "no_outreach_opt_in" });
  });
});
