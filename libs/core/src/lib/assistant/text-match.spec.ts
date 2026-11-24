import { matchWords, wordsOf } from "./text-match";

describe("assistant word matching", () => {
  it("keeps meaningful words, drops common ones and plural endings", () => {
    expect([...wordsOf("Acute upper respiratory infections, unspecified")]).toEqual(["acute", "upper", "respiratory", "infection"]);
    expect([...wordsOf("Ubo at sipon ng bata")]).toEqual(["ubo", "sipon", "bata"]);
    expect([...wordsOf("Pneumonía, type 2 E11")]).toEqual(["pneumonia", "2", "e11"]);
    expect(wordsOf("Abscess").has("abscess")).toBe(true);
  });

  it("measures how much of a candidate the text covers", () => {
    const text = wordsOf("Patient with acute upper respiratory infection, 3 days of cough");
    expect(matchWords(text, wordsOf("Acute upper respiratory infection"))).toEqual({ matched: ["acute", "upper", "respiratory", "infection"], coverage: 1 });
    expect(matchWords(text, wordsOf("Acute bronchitis")).coverage).toBe(0.5);
    expect(matchWords(text, new Set()).coverage).toBe(0);
  });
});
