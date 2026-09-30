import { describe, expect, it } from "vitest";
import { messageView, threadStatus, waitingFor } from "./messaging-mapping";

describe("messaging mapping", () => {
  it("defaults the queue to conversations waiting for the clinic", () => {
    expect(messageView(undefined)).toBe("awaiting");
    expect(messageView("closed")).toBe("closed");
    expect(messageView("nonsense")).toBe("awaiting");
  });

  it("labels a conversation by who has the next move", () => {
    expect(threadStatus({ status: "open", awaitingClinic: true }).label).toBe("Waiting for reply");
    expect(threadStatus({ status: "open", awaitingClinic: false }).label).toBe("Replied");
    expect(threadStatus({ status: "closed", awaitingClinic: false }).label).toBe("Closed");
  });

  it("says how long a conversation has waited", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(waitingFor("2026-06-10T11:40:00Z", now)).toBe("under an hour");
    expect(waitingFor("2026-06-10T11:00:00Z", now)).toBe("1 hour");
    expect(waitingFor("2026-06-10T04:00:00Z", now)).toBe("8 hours");
    expect(waitingFor("2026-06-09T11:00:00Z", now)).toBe("1 day");
    expect(waitingFor("2026-06-05T12:00:00Z", now)).toBe("5 days");
  });
});
