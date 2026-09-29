import { describe, expect, it } from "vitest";
import { requestOpen, requestState } from "./documents";

describe("records request wording", () => {
  it("tells the patient where a request stands", () => {
    expect(requestState("submitted")).toEqual({ tone: "waiting", text: "Sent — waiting for the records office" });
    expect(requestState("fulfilled").tone).toBe("done");
    expect(requestState("declined").tone).toBe("declined");
    expect(requestState("withdrawn").tone).toBe("closed");
  });
  it("lets the patient withdraw only open requests", () => {
    expect(requestOpen("submitted")).toBe(true);
    expect(requestOpen("in_review")).toBe(true);
    expect(requestOpen("fulfilled")).toBe(false);
  });
});
