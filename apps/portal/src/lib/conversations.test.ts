import { describe, expect, it } from "vitest";
import { charactersLeft, conversationMessage, threadState } from "./conversations";

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
});
