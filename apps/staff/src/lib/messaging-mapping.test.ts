import { describe, expect, it } from "vitest";
import { attachmentProblem, dueState, fileSize, messageView, threadStatus, waitingFor } from "./messaging-mapping";

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

  it("says where a conversation stands against its response target", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(dueState({ awaitingClinic: true, responseDueAt: null, overdue: false }, now)).toBeNull();
    expect(dueState({ awaitingClinic: false, responseDueAt: "2026-06-10T10:00:00Z", overdue: false }, now)).toBeNull();
    expect(dueState({ awaitingClinic: true, responseDueAt: "2026-06-10T15:00:00Z", overdue: false }, now)).toEqual({ label: "due in 3 hours", overdue: false });
    expect(dueState({ awaitingClinic: true, responseDueAt: "2026-06-08T12:00:00Z", overdue: true }, now)).toEqual({
      label: "2 days past target",
      overdue: true,
    });
    expect(dueState({ awaitingClinic: true, responseDueAt: "2026-06-10T11:40:00Z", overdue: true }, now)).toEqual({
      label: "20 min past target",
      overdue: true,
    });
  });

  it("checks files before they are attached", () => {
    expect(attachmentProblem([])).toBeNull();
    expect(
      attachmentProblem([
        { type: "image/jpeg", size: 100 },
        { type: "application/pdf", size: 100 },
      ]),
    ).toBeNull();
    expect(attachmentProblem([{ type: "application/zip", size: 100 }])).toMatch(/Only JPEG/);
    expect(attachmentProblem([{ type: "image/png", size: 11 * 1024 * 1024 }])).toMatch(/10 MB/);
    expect(attachmentProblem(Array(4).fill({ type: "image/png", size: 1 }))).toMatch(/At most 3/);
    expect(fileSize(500)).toBe("500 B");
    expect(fileSize(20480)).toBe("20 KB");
    expect(fileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
