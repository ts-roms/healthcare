import { describe, expect, it } from "vitest";
import { clientIp, forwardedHeaders } from "./forwarding";

const h = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? null });

describe("client identity forwarding", () => {
  it("uses the address added by the nearest proxy (right-most X-Forwarded-For entry)", () => {
    expect(clientIp(h({ "x-forwarded-for": "10.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "::1" }))).toBe("::1");
    expect(clientIp(h({}))).toBeUndefined();
  });

  it("forwards IP and user agent only when present", () => {
    expect(forwardedHeaders(h({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0" }))).toEqual({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0",
    });
    expect(forwardedHeaders(h({}))).toEqual({});
  });
});
