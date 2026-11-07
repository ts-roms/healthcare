import { ContextPool } from "./database-context";

describe("ContextPool", () => {
  it("survives an error from an idle client instead of leaving the event unhandled", async () => {
    const pool = new ContextPool({ connectionString: "postgres://u:p@127.0.0.1:1/none" }, "observe");
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    await pool.end();
  });
});
