import { interpretQuestion, PERIOD_KEY } from "@healthcare/core";
import { ASK_QUESTIONS } from "./ask-catalogue";

const TODAY = "2026-11-22";
const specs = ASK_QUESTIONS.map((q) => ({ ...q, allowed: true }));

describe("the Ask catalogue", () => {
  it("reads every example as its own question", () => {
    const misread = ASK_QUESTIONS.flatMap((q) =>
      q.examples
        .map((example) => ({ example, expected: q.id, got: interpretQuestion(example, specs, TODAY) }))
        .filter((r) => r.got.kind !== "question" || r.got.questionId !== r.expected),
    );
    expect(misread).toEqual([]);
  });

  it("keeps ids unique and well formed, with defaults that are periods", () => {
    expect(new Set(ASK_QUESTIONS.map((q) => q.id)).size).toBe(ASK_QUESTIONS.length);
    for (const q of ASK_QUESTIONS) {
      expect(q.id).toMatch(/^[a-z0-9][a-z0-9.-]{1,80}$/);
      expect(q.requires.length).toBeGreaterThan(0);
      expect(q.source).toMatch(/^GET \/[a-z]/);
      if (q.period === "range" || q.period === "day") expect(q.defaultPeriod).toMatch(PERIOD_KEY);
      else expect(q.defaultPeriod).toBeUndefined();
      if (q.comparable || q.organization) expect(q.period).toBe("range");
    }
  });

  it("tells close questions apart", () => {
    const id = (text: string) => {
      const read = interpretQuestion(text, specs, TODAY);
      return read.kind === "question" ? read.questionId : read.kind;
    };
    expect(id("missed appointments last week")).toBe("clinic.no-shows");
    expect(id("appointments tomorrow")).toBe("clinic.appointments");
    expect(id("who is waiting")).toBe("clinic.waiting-now");
    expect(id("waiting time this month")).toBe("clinic.wait-time");
    expect(id("lab turnaround")).toBe("laboratory.turnaround");
    expect(id("what is the lab waiting on")).toBe("laboratory.today");
    expect(id("revenue and collections this month")).toBe("billing.revenue");
    expect(id("collections today")).toBe("billing.collections");
    expect(id("who owes us the most")).toBe("billing.owed");
    expect(id("lab orders")).toBe("laboratory.today");
    expect(id("what is Maria Santos's diagnosis")).toBe("unrecognised");
  });
});
