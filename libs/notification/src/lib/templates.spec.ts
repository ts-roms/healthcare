import { findTemplate, TEMPLATES } from "./templates";

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

  it("keep staff free text inside the platform", () => {
    expect(findTemplate("staff.message")!.channels).toEqual(["in_app"]);
  });
});
