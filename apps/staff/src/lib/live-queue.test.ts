import { describe, expect, it } from "vitest";
import { LIVE_SAFETY_REFRESH_MS, liveStatusLabel, shouldPoll } from "./live-queue";

describe("shouldPoll", () => {
  it("polls on every tick until the socket is live", () => {
    expect(shouldPoll("connecting", 0, 1)).toBe(true);
    expect(shouldPoll("offline", 0, 1)).toBe(true);
  });

  it("only re-reads occasionally while live", () => {
    expect(shouldPoll("live", 0, 15_000)).toBe(false);
    expect(shouldPoll("live", 0, LIVE_SAFETY_REFRESH_MS)).toBe(true);
  });
});

describe("liveStatusLabel", () => {
  it("says whether updates are live or polled", () => {
    expect(liveStatusLabel("live")).toBe("Live");
    expect(liveStatusLabel("offline")).toMatch(/15 s/);
  });
});
