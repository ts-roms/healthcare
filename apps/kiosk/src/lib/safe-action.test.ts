import { describe, expect, it } from "vitest";
import { safely, UNREACHABLE } from "./safe-action";

describe("safely", () => {
  it("passes an answered call through untouched, success or error", async () => {
    expect(await safely(async () => ({ ok: true as const, data: 1 }))).toEqual({ ok: true, data: 1 });
    expect(await safely(async () => ({ ok: false as const, message: "No match", code: "identification_failed" }))).toEqual({
      ok: false,
      message: "No match",
      code: "identification_failed",
    });
  });

  it("turns a call that never came back into a plain failure the screen can show", async () => {
    const result = await safely(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result).toEqual({ ok: false, message: UNREACHABLE, code: "unreachable" });
    expect(UNREACHABLE).not.toMatch(/fetch|error|TypeError/i);
  });
});
