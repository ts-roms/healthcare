/**
 * A patient's own laboratory results as the API returns them to MyHealth (`GET /portal/results`,
 * `GET /portal/results/trend`), and the plain-language wording both patient apps (web and mobile) use for them.
 * The wording explains where a value sits against the laboratory's range; it never interprets what it means for
 * the patient's health — that is the doctor's conversation. Which results a patient may see is decided by the API.
 */

export type PortalResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

/** `GET /portal/results` row: a released result the laboratory allows patients to see. */
export interface PortalResult {
  id: string;
  testId: string;
  testName: string;
  orderId: string;
  orderNumber: string;
  resultType: "numeric" | "text" | "coded";
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: PortalResultFlag | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  collectedAt: string | null;
  releasedAt: string | null;
  corrected: boolean;
  /** The partner (reference) laboratory that performed the test; null: the clinic's own laboratory. */
  performingLaboratory: string | null;
}

/** `GET /portal/results/trend?testId=` */
export interface PortalTrend {
  analyte: string;
  testName: string;
  unit: string | null;
  points: PortalResult[];
}

export type ResultTone = "normal" | "attention" | "urgent" | "neutral";

export function resultMeaning(result: Pick<PortalResult, "flag">): { tone: ResultTone; text: string } {
  switch (result.flag) {
    case "normal":
      return { tone: "normal", text: "Within the usual range" };
    case "high":
      return { tone: "attention", text: "Higher than the usual range" };
    case "low":
      return { tone: "attention", text: "Lower than the usual range" };
    case "abnormal":
      return { tone: "attention", text: "Outside what is usually expected" };
    case "critical_high":
      return { tone: "urgent", text: "Much higher than the usual range — your care team has been told" };
    case "critical_low":
      return { tone: "urgent", text: "Much lower than the usual range — your care team has been told" };
    default:
      return { tone: "neutral", text: "No usual range to compare with" };
  }
}

export function resultValue(result: Pick<PortalResult, "resultType" | "valueNumeric" | "valueText" | "valueCoded">): string {
  if (result.resultType === "numeric") return result.valueNumeric === null ? "—" : String(result.valueNumeric);
  return (result.resultType === "coded" ? result.valueCoded : result.valueText) ?? "—";
}

/** "Usual range: 3.9 to 5.5 mmol/L" */
export function usualRange(result: Pick<PortalResult, "refLow" | "refHigh" | "refText" | "unit">): string | null {
  const unit = result.unit ? ` ${result.unit}` : "";
  if (result.refLow !== null && result.refHigh !== null) return `Usual range: ${result.refLow} to ${result.refHigh}${unit}`;
  if (result.refHigh !== null) return `Usual range: up to ${result.refHigh}${unit}`;
  if (result.refLow !== null) return `Usual range: ${result.refLow}${unit} or more`;
  return result.refText ? `Expected: ${result.refText}` : null;
}

/**
 * The version of the result wording below (`resultExplanation`). Organizations record who reviewed it under Settings →
 * Compliance ("Results shown to patients"); raise it whenever a sentence changes, so a review names what it covered.
 */
export const RESULT_WORDING_VERSION = 1;

/** The range as a phrase: "3.9 to 5.5 mmol/L", "up to 5.5 mmol/L", "3.9 mmol/L or more"; null without numeric limits. */
function rangePhrase(result: Pick<PortalResult, "refLow" | "refHigh" | "unit">): string | null {
  const unit = result.unit ? ` ${result.unit}` : "";
  if (result.refLow !== null && result.refHigh !== null) return `${result.refLow} to ${result.refHigh}${unit}`;
  if (result.refHigh !== null) return `up to ${result.refHigh}${unit}`;
  if (result.refLow !== null) return `${result.refLow}${unit} or more`;
  return null;
}

/**
 * A result explained in fixed words (version `RESULT_WORDING_VERSION`): where the value sits against the usual range of
 * the laboratory that did the test — the range recorded with the result — what a usual range is, and that the doctor
 * explains the rest. It never says what a value means for the patient's health, and a critical result says only that the
 * care team was told (patients see one only after the care team acknowledged it).
 */
export function resultExplanation(
  result: Pick<
    PortalResult,
    "resultType" | "valueNumeric" | "valueText" | "valueCoded" | "unit" | "flag" | "refLow" | "refHigh" | "refText" | "corrected" | "performingLaboratory"
  >,
): string[] {
  const value = `${resultValue(result)}${result.resultType === "numeric" && result.unit ? ` ${result.unit}` : ""}`;
  const range = rangePhrase(result);
  const at = result.performingLaboratory ? `at ${result.performingLaboratory}` : "at the laboratory that did it";
  const against = range ? `: ${range}` : "";
  const sentences: string[] = [];
  switch (result.flag) {
    case "normal":
      sentences.push(`Your result, ${value}, is within the usual range for this test ${at}${against}.`);
      break;
    case "high":
    case "low":
      sentences.push(`Your result, ${value}, is ${result.flag === "high" ? "higher" : "lower"} than the usual range for this test ${at}${against}.`);
      break;
    case "critical_high":
    case "critical_low":
      sentences.push(
        `Your result, ${value}, is much ${result.flag === "critical_high" ? "higher" : "lower"} than the usual range for this test ${at}${against}.`,
        "Results this far from the usual range are reported to your care team as soon as the laboratory finds them; your care team was told about this one before it was shown here.",
      );
      break;
    case "abnormal":
      sentences.push(
        range
          ? `Your result, ${value}, is outside the usual range for this test ${at}${against}.`
          : result.refText
            ? `Your result, ${value}, is not what is usually expected for this test (expected: ${result.refText}).`
            : `Your result, ${value}, is outside what is usually expected for this test.`,
      );
      break;
    default:
      sentences.push(
        range
          ? `Your result is ${value}. The usual range for this test ${at} is ${range}.`
          : result.refText
            ? `Your result is ${value}. What is usually expected for this test: ${result.refText}.`
            : `Your result is ${value}. There is no usual range to compare it with.`,
      );
  }
  if (range || result.refText || (result.flag && result.flag !== "normal")) {
    sentences.push(
      "A usual range describes the results of most healthy people tested by that laboratory, so a result outside it is not always a problem, and one inside it does not rule a problem out.",
    );
  }
  if (result.corrected) sentences.push("The laboratory updated this result after it was first released; this is the current value.");
  sentences.push("Your doctor will explain what your result means for you.");
  return sentences;
}

/** The latest visible result per test, newest first. */
export function latestPerTest(results: PortalResult[]): Array<{ latest: PortalResult; count: number }> {
  const byTest = new Map<string, PortalResult[]>();
  for (const r of results) byTest.set(r.testId, [...(byTest.get(r.testId) ?? []), r]);
  return [...byTest.values()]
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => when(b) - when(a));
      return { latest: sorted[0]!, count: rows.length };
    })
    .sort((a, b) => when(b.latest) - when(a.latest));
}

function when(r: PortalResult): number {
  return new Date(r.collectedAt ?? r.releasedAt ?? 0).getTime();
}

/** "Sep 30, 2026" in the patient's clinic's time zone (results, prescriptions and bills carry instants). */
export function resultDate(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}
