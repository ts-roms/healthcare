import { ASK_NOTE_TEXT, type AskQuestionSpec, interpretQuestion, questionWords } from "./interpret";

const TODAY = "2026-11-22";

const CATALOGUE: AskQuestionSpec[] = [
  { id: "no-shows", words: [["no show", "noshow", "missed appointment"]], period: "range", comparable: true, allowed: true },
  {
    id: "wait-time",
    words: [
      ["wait", "waiting", "waited"],
      ["time", "long", "average", "median"],
    ],
    period: "range",
    comparable: true,
    allowed: true,
  },
  { id: "waiting-now", words: [["waiting", "wait", "queue"]], period: "now", comparable: false, allowed: true },
  { id: "revenue", words: [["revenue", "income", "invoiced"]], period: "range", comparable: true, allowed: false },
  { id: "collections", words: [["collected", "collection", "payment"]], period: "day", comparable: false, allowed: true },
  { id: "turnaround", words: [["turnaround", "tat"]], hints: [["lab", "laboratory", "result"]], period: "range", comparable: true, allowed: true },
  { id: "lab-today", words: [["lab", "laboratory", "specimen"]], period: "now", comparable: false, allowed: true },
  { id: "low-stock", words: [["low", "run out", "out of stock"]], period: "none", comparable: false, allowed: true },
  { id: "income", words: [["income"]], period: "range", comparable: true, allowed: true },
];
const ask = (text: string) => interpretQuestion(text, CATALOGUE, TODAY);

describe("interpreting a question", () => {
  it("finds the question, its period and comparison", () => {
    expect(ask("How many no-shows last week?")).toEqual({ kind: "question", questionId: "no-shows", period: "last-week", allFacilities: false, notes: [] });
    expect(ask("no shows this month vs last month")).toMatchObject({ questionId: "no-shows", period: "this-month", compare: "previous" });
    expect(ask("NO-SHOWS in October across all facilities")).toMatchObject({ questionId: "no-shows", period: "2026-10", allFacilities: true });
  });

  it("leaves the period to the question's default when none is named", () => {
    expect(ask("what is running low?")).toEqual({ kind: "question", questionId: "low-stock", allFacilities: false, notes: [] });
  });

  it("uses the period to choose between a question about the present and one about a period", () => {
    expect(ask("who is waiting")).toMatchObject({ questionId: "waiting-now" });
    expect(ask("how long did patients wait last week")).toMatchObject({ questionId: "wait-time", period: "last-week" });
    // More words found wins: "waiting time" names both groups of the period question.
    expect(ask("average waiting time")).toMatchObject({ questionId: "wait-time" });
    // "Now" keeps the question about the present even when it names more words of the other.
    expect(ask("how long is the wait right now")).toMatchObject({ questionId: "waiting-now" });
  });

  it("prefers the question whose hints are found too", () => {
    expect(ask("lab turnaround this month")).toMatchObject({ questionId: "turnaround" });
    expect(ask("what is the lab waiting on")).toMatchObject({ kind: "ambiguous" });
  });

  it("between two that fit equally, prefers the one the person may see, else asks which", () => {
    expect(ask("income this month")).toMatchObject({ kind: "question", questionId: "income" });
    // The period read travels with the choice, so the question chosen keeps it.
    expect(
      interpretQuestion(
        "income this month vs last year",
        CATALOGUE.map((q) => ({ ...q, allowed: true })),
        TODAY,
      ),
    ).toEqual({
      kind: "ambiguous",
      questionIds: ["revenue", "income"],
      period: "this-month",
      compare: "last-year",
      allFacilities: false,
    });
  });

  it("says what was left out when it does not apply", () => {
    expect(ask("what is running low last month")).toMatchObject({ questionId: "low-stock", notes: ["period-not-applicable"] });
    expect(ask("collections last week")).toMatchObject({ questionId: "collections", notes: ["day-only"] });
    expect(ask("collections yesterday vs last year")).toMatchObject({ questionId: "collections", period: "yesterday", notes: ["not-comparable"] });
    expect(ASK_NOTE_TEXT["day-only"]).toBe("This question is about one day, so the period you named was left out.");
  });

  it("answers nothing it does not recognise, and reads only the first 200 characters", () => {
    expect(ask("what is Juan dela Cruz's blood pressure")).toEqual({ kind: "unrecognised" });
    expect(ask("")).toEqual({ kind: "unrecognised" });
    expect(ask(`${"x ".repeat(120)} no-shows`)).toEqual({ kind: "unrecognised" });
  });

  it("reads words without plurals or punctuation", () => {
    expect(questionWords("No-Shows, specimens; less")).toEqual(["no", "show", "specimen", "less"]);
  });
});
