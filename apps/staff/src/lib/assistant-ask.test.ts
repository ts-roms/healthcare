import { describe, expect, it } from "vitest";
import { askAnswerView, askHref, hrefForEntry, hrefForInterpretation, readAskParams, readChoice } from "./assistant-ask";

describe("askAnswerView", () => {
  it("shows the dates, comparison and facility the answer used, as the page and the chat both show them", () => {
    const view = askAnswerView({
      question: { id: "clinic.no-shows", version: 1, title: "No-shows" },
      status: "answered",
      sentence: "4 of 120 booked appointments were no-shows.",
      period: { key: "last-week", label: "Last week", from: "2026-11-16", to: "2026-11-22", text: "16–22 November 2026" },
      comparison: { mode: "previous", label: "the period before", from: "2026-11-09", to: "2026-11-15", text: "9–15 November 2026" },
      scope: { kind: "facility", name: "Main Clinic" },
      rows: [{ label: "No-shows", value: "4", previous: "6" }],
      notes: [],
      definition: "No-shows ÷ appointments booked",
      link: { label: "Open the management dashboard", href: "/management" },
      entry: { id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(view).toMatchObject({
      title: "No-shows",
      periodText: "Last week · 16–22 November 2026",
      comparisonText: "the period before · 9–15 November 2026",
      scopeName: "Main Clinic",
      link: { href: "/management" },
    });
    // A question without a period (stock now) names none.
    expect(askAnswerView(withoutPeriod)).toMatchObject({ periodText: null, comparisonText: null });
  });
});

const withoutPeriod = {
  question: { id: "inventory.low", version: 1, title: "Low stock" },
  status: "answered" as const,
  sentence: "2 items are at or below their reorder level.",
  period: null,
  comparison: null,
  scope: { kind: "facility" as const, name: "Main Clinic" },
  rows: [],
  notes: [],
  definition: null,
  link: null,
  entry: null,
};

describe("Ask addresses", () => {
  it("name the question, period, comparison and scope, never the words typed", () => {
    const href = hrefForInterpretation({
      kind: "question",
      questionId: "billing.revenue",
      title: "Revenue and collections",
      period: "this-month",
      compare: "previous",
      scope: "organization",
      notes: [],
    });
    expect(href).toBe("/assistant/ask?question=billing.revenue&period=this-month&compare=previous&scope=all");
    expect(askHref({ questionId: "inventory.low", notes: ["period-not-applicable"] })).toBe(
      "/assistant/ask?question=inventory.low&notes=period-not-applicable",
    );
    // Nothing recognised: no address at all (the box says so and keeps the words).
    expect(hrefForInterpretation({ kind: "unrecognised" })).toBeNull();
  });

  it("offer a choice that keeps the period read for whichever question is chosen", () => {
    const href = hrefForInterpretation({
      kind: "ambiguous",
      candidates: [
        { id: "a.one", title: "One" },
        { id: "b.two", title: "Two" },
      ],
      period: "last-week",
      scope: "facility",
    });
    expect(href).toBe("/assistant/ask?choose=a.one%2Cb.two&period=last-week");
    const search = Object.fromEntries(new URL(href!, "http://staff").searchParams);
    expect(readChoice(search)).toEqual({ questionIds: ["a.one", "b.two"], reading: { period: "last-week" } });
    expect(readChoice({ choose: "a.one,<b>,c.three", compare: "last-year", scope: "all" })).toEqual({
      questionIds: ["a.one", "c.three"],
      reading: { compare: "last-year", scope: "organization" },
    });
    expect(readChoice({})).toEqual({ questionIds: [], reading: {} });
  });

  it("read back only what is a question, a period, a comparison or a note", () => {
    expect(readAskParams({ question: "clinic.no-shows", period: "last-week", compare: "last-year", scope: "all", notes: "day-only,bogus" })).toEqual({
      questionId: "clinic.no-shows",
      period: "last-week",
      compare: "last-year",
      scope: "organization",
      notes: ["day-only"],
    });
    expect(readAskParams({})).toBeNull();
    expect(readAskParams({ question: "<script>" })).toBeNull();
    expect(readAskParams({ question: "inventory.low", period: "Juan Dela Cruz", compare: "sideways" })).toEqual({ questionId: "inventory.low" });
    expect(readAskParams({ question: ["inventory.low", "billing.owed"] })).toEqual({ questionId: "inventory.low" });
  });

  it("ask an entry of the person's questions again", () => {
    const entry = {
      id: "e1",
      questionId: "clinic.no-shows",
      label: "No-shows, Last week",
      period: "last-week",
      compare: null,
      scope: "facility" as const,
      timesAsked: 1,
      lastAskedAt: "2026-11-22T00:00:00Z",
      savedAt: null,
    };
    expect(hrefForEntry(entry)).toBe("/assistant/ask?question=clinic.no-shows&period=last-week");
    expect(hrefForEntry({ ...entry, period: null, compare: "previous", scope: "organization" })).toBe(
      "/assistant/ask?question=clinic.no-shows&compare=previous&scope=all",
    );
  });
});
