import { describe, expect, it } from "vitest";
import { ApiError, toApiError, userMessage } from "./errors";

describe("toApiError", () => {
  it("reads the API error envelope", async () => {
    const res = new Response(
      JSON.stringify({ error: { code: "possible_duplicates", message: "Review them", details: { candidates: [] }, requestId: "abcdef12-3456" } }),
      {
        status: 409,
      },
    );
    const e = await toApiError(res);
    expect(e).toMatchObject({ status: 409, code: "possible_duplicates", message: "Review them", requestId: "abcdef12-3456" });
    expect(userMessage(e)).toBe("Review them (ref abcdef12)");
  });

  it("falls back for non-JSON bodies (e.g. a proxy error page)", async () => {
    const e = await toApiError(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    expect(e).toMatchObject({ status: 502, code: "http_502", message: "Bad Gateway" });
  });

  it("never exposes internal errors to staff", () => {
    expect(userMessage(new Error("connect ECONNREFUSED 10.0.0.5:3000"))).toBe("The server could not be reached. Try again.");
    expect(userMessage(new ApiError(403, "forbidden", "Not allowed"))).toBe("Not allowed");
  });
});
