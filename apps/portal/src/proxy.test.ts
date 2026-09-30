import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://localhost:3001"), { headers });
}

const SIGNED_IN = { hp_at: "access", hp_rt: "refresh" };

describe("portal proxy", () => {
  it("sends signed-out patients to sign in, keeping where they were going", async () => {
    const response = await proxy(request("/results"));
    expect(response.headers.get("location")).toBe("http://localhost:3001/login?next=%2Fresults");
  });

  it("lets signed-out patients reach sign-in and activation", async () => {
    for (const path of ["/login", "/activate", "/forgot-password"]) expect((await proxy(request(path))).headers.get("location")).toBeNull();
  });

  it("opens the password-reset link to everyone, signed in or not", async () => {
    expect((await proxy(request("/reset-password"))).headers.get("location")).toBeNull();
    expect((await proxy(request("/reset-password", SIGNED_IN))).headers.get("location")).toBeNull();
  });

  it("shows the MyHealth guide to everyone, signed in or not", async () => {
    expect((await proxy(request("/help"))).headers.get("location")).toBeNull();
    expect((await proxy(request("/help", SIGNED_IN))).headers.get("location")).toBeNull();
  });

  it("skips the sign-in form for a signed-in patient", async () => {
    expect((await proxy(request("/login", SIGNED_IN))).headers.get("location")).toBe("http://localhost:3001/");
  });

  it("clears stale cookies when the API ended the session, instead of redirecting back (no loop)", async () => {
    const response = await proxy(request("/login?reason=session", SIGNED_IN));
    expect(response.headers.get("location")).toBeNull();
    const cleared = response.cookies.getAll().filter((c) => c.value === "" && ["hp_at", "hp_rt"].includes(c.name));
    expect(cleared).toHaveLength(2);
  });

  it("passes signed-in requests through without refreshing", async () => {
    const response = await proxy(request("/profile", SIGNED_IN));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
