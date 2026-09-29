import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

const SIGNED_IN = { hc_at: "access", hc_rt: "refresh" };

describe("staff proxy", () => {
  it("sends signed-out users to sign in, keeping where they were going", async () => {
    const response = await proxy(request("/patients"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fpatients");
  });

  it("lets signed-out users reach sign-in", async () => {
    for (const path of ["/login"]) expect((await proxy(request(path))).headers.get("location")).toBeNull();
  });

  it("serves the landing page to everyone without touching the session", async () => {
    for (const cookies of [{}, SIGNED_IN, { hc_rt: "refresh" }] as Record<string, string>[]) {
      const response = await proxy(request("/welcome", cookies));
      expect(response.headers.get("location")).toBeNull();
      expect(response.cookies.getAll()).toHaveLength(0);
    }
  });

  it("does not treat paths below the landing page as public", async () => {
    expect((await proxy(request("/welcome/patients"))).headers.get("location")).toContain("/login");
  });

  it("skips the sign-in form for a signed-in user", async () => {
    expect((await proxy(request("/login", SIGNED_IN))).headers.get("location")).toBe("http://localhost:3000/");
  });

  it("clears stale cookies when the API ended the session, instead of redirecting back (no loop)", async () => {
    const response = await proxy(request("/login?reason=session", SIGNED_IN));
    expect(response.headers.get("location")).toBeNull();
    const cleared = response.cookies.getAll().filter((c) => c.value === "" && ["hc_at", "hc_rt"].includes(c.name));
    expect(cleared).toHaveLength(2);
  });

  it("passes signed-in requests through without refreshing", async () => {
    const response = await proxy(request("/patients", SIGNED_IN));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
