import { describe, expect, it } from "vitest";
import { open, seal, sessionKey } from "./crypto";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe("offline outbox encryption", () => {
  it("round-trips through the session key and refuses another session's key", async () => {
    const storage = new MemoryStorage();
    const key = (await sessionKey(storage))!;
    const sealed = await seal(key, { familyName: "Reyes", vitals: { heartRateBpm: 80 } });
    expect(sealed).not.toContain("Reyes");
    expect(await open(key, sealed)).toEqual({ familyName: "Reyes", vitals: { heartRateBpm: 80 } });
    // The same storage gives the same key again (a reload of the tab); a different session cannot read it.
    expect(await open((await sessionKey(storage))!, sealed)).not.toBeNull();
    expect(await open((await sessionKey(new MemoryStorage()))!, sealed)).toBeNull();
    expect(await open(key, "damaged")).toBeNull();
    expect(await sessionKey(null)).toBeNull();
  });
});
