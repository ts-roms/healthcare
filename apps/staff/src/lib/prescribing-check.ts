import type { MedicineSetting } from "./api/types";
import type { LinePayload } from "./prescription-form";

/**
 * The prescribing dialog's check before issuing (docs/domains/assistant.md, the prescribing rules) and the wording of the
 * organization's medicine settings (`/clinic/prescribing`). The API reads and decides; these only shape the request and
 * the words.
 */

/** What the prescribing rules compare in a drafted medicine: the name, the dose and how often. */
export interface DraftMedicine {
  genericName: string;
  brandName?: string;
  strength?: string;
  doseAmount?: number;
  doseUnit?: string;
  frequency: string;
}

export function draftMedicines(items: readonly LinePayload[]): DraftMedicine[] {
  return items.map((i) => ({
    genericName: i.genericName,
    ...(i.brandName ? { brandName: i.brandName } : {}),
    ...(i.strength ? { strength: i.strength } : {}),
    ...(i.doseAmount !== undefined ? { doseAmount: i.doseAmount } : {}),
    ...(i.doseUnit ? { doseUnit: i.doseUnit } : {}),
    frequency: i.frequency,
  }));
}

/** The same draft, the same key: a draft already checked and shown is issued on the next click. */
export function draftKey(medicines: readonly DraftMedicine[]): string {
  return JSON.stringify(
    medicines.map((m) => [m.genericName.trim().toLowerCase(), m.strength ?? "", m.doseAmount ?? null, (m.doseUnit ?? "").toLowerCase(), m.frequency]),
  );
}

const number = (n: number) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(n);

/** A setting in words: "Class NSAID · at most 3,200 mg a day · check kidney function"; "Check pregnancy". */
export function describeMedicineSetting(s: Pick<MedicineSetting, "className" | "maxDailyDose" | "doseUnit" | "checkRenal" | "checkPregnancy">): string {
  const checks = [...(s.checkRenal ? ["kidney function"] : []), ...(s.checkPregnancy ? ["pregnancy"] : [])];
  const text = [
    s.className ? `Class ${s.className}` : null,
    s.maxDailyDose && s.doseUnit ? `at most ${number(s.maxDailyDose)} ${s.doseUnit} a day` : null,
    checks.length ? `check ${checks.join(" and ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A maximum typed as "3200" or "3,200": a positive number, or null when blank; NaN when it is not a number. */
export function parseMaximum(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}
