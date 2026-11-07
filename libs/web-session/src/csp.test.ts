import { describe, expect, it } from "vitest";
import { buildAppCsp, newNonce, parseOrigins } from "./csp";

describe("buildAppCsp", () => {
  it("runs only scripts with this request's nonce, and nothing from outside but what is listed", () => {
    const policy = buildAppCsp("abc123", { realtimeUrl: "https://api.example.ph/realtime", connectOrigins: ["wss://video.example.ph"] });
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("connect-src 'self' https://api.example.ph wss://api.example.ph https://video.example.ph wss://video.example.ph");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'self'");
  });

  it("allows eval only in development, and ignores values that are not URLs", () => {
    expect(buildAppCsp("n", { development: true })).toContain("'unsafe-eval'");
    expect(buildAppCsp("n", { connectOrigins: ["not a url", "javascript:alert(1)"] })).toContain("connect-src 'self';");
  });

  it("reads a list of origins and makes a different nonce each time", () => {
    expect(parseOrigins(" wss://a.example, https://b.example  ")).toEqual(["wss://a.example", "https://b.example"]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(newNonce()).not.toBe(newNonce());
  });
});
