import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("kiosk content security policy", () => {
  it("lets only scripts with the request's nonce run, and nothing load from another origin", () => {
    const policy = buildCsp("abc123");
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/https?:\/\//);
  });

  it("allows eval only in development, where React needs it", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", false)).not.toContain("'unsafe-eval'");
  });

  it("makes a different nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce().length).toBeGreaterThanOrEqual(16);
  });
});
