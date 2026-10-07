import { findTemplate, STAFF_PUSH_KIND_LABEL, TEMPLATES, withoutSecrets } from "./templates";

describe("notification templates", () => {
  it("have unique keys", () => {
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("give every staff notice that pushes a kind the member can turn off, except the test push", () => {
    // Staff notices are the ones with content-free push wording (patient templates push the same text as the in-app row).
    const pushing = TEMPLATES.filter((t) => t.channels.includes("in_app") && t.channels.includes("push") && t.renderPush);
    expect(pushing.length).toBeGreaterThanOrEqual(7);
    for (const t of pushing) expect(t.pushKind && STAFF_PUSH_KIND_LABEL[t.pushKind]).toBeTruthy();
    expect(findTemplate("staff.push-test")!.pushKind).toBeUndefined();
    expect(findTemplate("staff.message")!.pushKind).toBeUndefined();
  });

  it("validate variables and render", () => {
    const template = findTemplate("patient.registered");
    expect(template).toBeDefined();
    const variables = template!.variables.parse({ givenName: "Juan", organizationName: "Demo Health", patientNumber: "P00000001" });
    expect(template!.render(variables).text).toBe("Hi Juan, you are now registered at Demo Health. Your patient number is P00000001.");
    expect(template!.variables.safeParse({ givenName: "Juan" }).success).toBe(false);
  });

  it("tell the patient a referral letter is ready without naming the recipient or the reason", () => {
    const records = findTemplate("records.update")!;
    const text = records.render(records.variables.parse({ kind: "referral-ready", organizationName: "Demo Health" }) as never).text;
    expect(text).toBe("Demo Health: a referral letter from your visit is ready in MyHealth. Sign in to see it and download the letter.");
    expect(records.variables.safeParse({ kind: "referral-ready" }).success).toBe(false);
  });

  it("keep security messages internal and blank their credentials once stored", () => {
    const reset = findTemplate("portal.password-reset")!;
    expect(reset.internal).toBe(true);
    expect(reset.channels).toEqual(["email"]);
    const variables = reset.variables.parse({
      organizationName: "Demo Health",
      link: "https://myhealth.example.ph/reset-password#token=abc",
      validMinutes: 30,
    });
    expect(reset.render(variables).text).toContain("#token=abc");
    expect(withoutSecrets(reset, variables as Record<string, unknown>)).toEqual({ organizationName: "Demo Health", link: "[removed]", validMinutes: 30 });
    expect(withoutSecrets(findTemplate("portal.password-changed")!, { organizationName: "Demo Health" })).toEqual({ organizationName: "Demo Health" });
  });

  it("keeps verification codes out of the stored notification and renders security alerts", () => {
    const code = findTemplate("portal.email-verification")!;
    expect(code.internal).toBe(true);
    const variables = code.variables.parse({ organizationName: "Demo Health", code: "123456", validMinutes: 15 }) as Record<string, unknown>;
    expect(withoutSecrets(code, variables)).toEqual({ organizationName: "Demo Health", code: "[removed]", validMinutes: 15 });
    expect(code.variables.safeParse({ organizationName: "Demo", code: "12345", validMinutes: 15 }).success).toBe(false);
    const alert = findTemplate("portal.security-alert")!;
    const recovery = alert.variables.parse({ organizationName: "Demo Health", event: "recovery_code_used", detail: "7" }) as never;
    expect(alert.render(recovery).text).toContain("(7 left)");
  });

  it("keep staff free text inside the platform", () => {
    expect(findTemplate("staff.message")!.channels).toEqual(["in_app"]);
  });
});
