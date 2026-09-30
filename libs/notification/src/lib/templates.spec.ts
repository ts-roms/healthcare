import { findTemplate, TEMPLATES, withoutSecrets } from "./templates";

describe("notification templates", () => {
  it("have unique keys", () => {
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("validate variables and render", () => {
    const template = findTemplate("patient.registered");
    expect(template).toBeDefined();
    const variables = template!.variables.parse({ givenName: "Juan", organizationName: "Demo Health", patientNumber: "P00000001" });
    expect(template!.render(variables).text).toBe("Hi Juan, you are now registered at Demo Health. Your patient number is P00000001.");
    expect(template!.variables.safeParse({ givenName: "Juan" }).success).toBe(false);
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

  it("keep staff free text inside the platform", () => {
    expect(findTemplate("staff.message")!.channels).toEqual(["in_app"]);
  });
});
