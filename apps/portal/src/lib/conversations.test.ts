import { describe, expect, it } from "vitest";
import { attachmentProblem, charactersLeft, conversationMessage, fileSize, threadState } from "./conversations";

describe("conversations", () => {
  it("says where a conversation stands", () => {
    expect(threadState({ status: "closed", lastMessageFrom: "staff", unread: false })).toBe("Closed");
    expect(threadState({ status: "open", lastMessageFrom: "staff", unread: true })).toBe("New reply");
    expect(threadState({ status: "open", lastMessageFrom: "staff", unread: false })).toBe("Replied");
    expect(threadState({ status: "open", lastMessageFrom: "patient", unread: false })).toBe("Waiting for the clinic");
  });

  it("puts refusals in the patient's words", () => {
    expect(conversationMessage("thread_closed", "x")).toContain("Start a new message");
    expect(conversationMessage("message_rate_limited", "x")).toContain("last hour");
    expect(conversationMessage("other", "Fallback")).toBe("Fallback");
  });

  it("counts what is left to write", () => {
    expect(charactersLeft("hello")).toBe(1995);
    expect(charactersLeft("x".repeat(2001))).toBe(-1);
  });

  it("checks files before they are sent", () => {
    expect(attachmentProblem([])).toBeNull();
    expect(
      attachmentProblem([
        { type: "image/heic", size: 10 },
        { type: "application/pdf", size: 10 },
      ]),
    ).toBeNull();
    expect(attachmentProblem([{ type: "video/mp4", size: 10 }])).toMatch(/Only photos/);
    expect(attachmentProblem([{ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }])).toMatch(/10 MB/);
    expect(attachmentProblem(Array(4).fill({ type: "image/jpeg", size: 1 }))).toMatch(/up to 3/);
    expect(fileSize(2048)).toBe("2 KB");
    expect(conversationMessage("upload_rate_limited", "x")).toMatch(/many files today/);
  });
});
