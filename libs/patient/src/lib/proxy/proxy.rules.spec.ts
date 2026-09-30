import { grantAllows, grantLive, scopeNeeded } from "./proxy.rules";

describe("proxy access rules", () => {
  it("needs the view scope to read and the act scope to change anything", () => {
    expect(scopeNeeded("GET")).toBe("view");
    expect(scopeNeeded("HEAD")).toBe("view");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(scopeNeeded(method)).toBe("act");
    expect(grantAllows(["view"], "GET")).toBe(true);
    expect(grantAllows(["view"], "POST")).toBe(false);
    expect(grantAllows(["view", "act"], "POST")).toBe(true);
  });

  it("counts a grant live until it is ended or past its end date", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(grantLive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(grantLive({ revokedAt: null, expiresAt: new Date("2026-10-01T00:00:00Z") }, now)).toBe(true);
    expect(grantLive({ revokedAt: null, expiresAt: now }, now)).toBe(false);
    expect(grantLive({ revokedAt: new Date("2026-09-01T00:00:00Z"), expiresAt: null }, now)).toBe(false);
  });
});
