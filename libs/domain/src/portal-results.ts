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
