import { localDate, type RuleDefinition, type Suggestion, type SuggestionEvidence, suggestionId } from "@healthcare/core";
import { z } from "zod";
import { sameUnit } from "../dispensing/dispensing.rules";
import { medicineWords, unitKey } from "./prescribing.rules";

/**
 * The assistant's pharmacy rules (docs/domains/assistant.md, phase 3), on the pharmacy screens: medicines that waiting
 * prescriptions need more of than the facility holds, and stock that would be handed over for a course it does not
 * last. Stock is matched to a prescribed medicine by the words of its name and its strength — like the dispense form's
 * ranking, a heuristic: the pharmacist still chooses the item. They read names, quantities and dates; they change
 * nothing, order nothing and never choose a lot (dispensing takes the earliest expiry first).
 */

const DAY_MS = 86_400_000;
const DURATION_DAYS = { days: 1, weeks: 7, months: 30 } as const;
const REQUIRES = ["prescription.dispense", "inventory.read"] as const;

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const number = (n: number): string => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n);

// ---- matching stock to a prescribed medicine --------------------------------------------------------------------------

/** Salt and hydrate words: "metformin HCl" is metformin, unless both names give a salt and they differ. */
const SALT_WORDS = new Set([
  "hcl",
  "hydrochloride",
  "sodium",
  "potassium",
  "calcium",
  "magnesium",
  "trihydrate",
  "dihydrate",
  "monohydrate",
  "anhydrous",
  "maleate",
  "besylate",
  "besilate",
  "mesylate",
  "mesilate",
  "tartrate",
  "succinate",
  "citrate",
  "sulfate",
  "sulphate",
  "phosphate",
  "acetate",
  "fumarate",
  "bromide",
  "hydrobromide",
]);

const STRENGTH = /(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|units?|%)(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|l|g|tab|tablet|capsule))?(?![a-z])/i;

/** A strength as compared: "500 mg" → "500mg", "250 mg / 5 mL" → "250mg/5ml"; null when none can be read. */
export function strengthKey(text: string | null | undefined): string | null {
  const match = STRENGTH.exec((text ?? "").replace(/,/g, ""));
  if (!match) return null;
  const unit = (u: string) => (/^units?$/i.test(u) ? "unit" : unitKey(u));
  const per = match[4] ? `/${match[3] ? Number(match[3]) : ""}${unit(match[4])}` : "";
  return `${Number(match[1])}${unit(match[2]!)}${per}`;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((w) => b.includes(w));

/**
 * Whether a stock item can be the prescribed medicine: the same name words apart from salts ("Losartan" and "Losartan
 * potassium 50 mg tablet", but never "Amoxicillin" and "Amoxicillin + clavulanate"), the same salt when both name one,
 * and the same strength when both state one.
 */
export function stockMatches(stockName: string, medicine: { genericName: string; strength: string | null }): boolean {
  const stock = medicineWords(stockName);
  const prescribed = medicineWords(medicine.genericName);
  if (stock.length === 0 || prescribed.length === 0) return false;
  const core = (words: string[]) => words.filter((w) => !SALT_WORDS.has(w));
  const salts = (words: string[]) => words.filter((w) => SALT_WORDS.has(w));
  const [stockCore, prescribedCore] = [core(stock), core(prescribed)];
  // A medicine named only by salt words ("potassium chloride") must match as written.
  if (stockCore.length === 0 || prescribedCore.length === 0) {
    if (!sameSet(stock, prescribed)) return false;
  } else {
    if (!sameSet(stockCore, prescribedCore)) return false;
    const [a, b] = [salts(stock), salts(prescribed)];
    if (a.length > 0 && b.length > 0 && !sameSet(a, b)) return false;
  }
  const own = strengthKey(stockName);
  const wanted = strengthKey(medicine.strength) ?? strengthKey(medicine.genericName);
  return own === null || wanted === null || own === wanted;
}

/** Usable stock at the facility at the moment, per location, item and lot. */
export interface UsableLot {
  locationId: string;
  locationName: string;
  itemId: string;
  itemName: string;
  stockUnit: string;
  lotNumber: string | null;
  /** The last usable day (YYYY-MM-DD); null when the lot has none. */
  expiryDate: string | null;
  quantity: number;
}

const medicineLabel = (m: { genericName: string; strength: string | null }) =>
  m.strength ? `${m.genericName.trim()} ${m.strength.trim()}` : m.genericName.trim();

// ---- dispensing.short-stock ------------------------------------------------------------------------------------------

export const shortStockParameters = z.object({
  /** Prescriptions issued at the facility in this many days count as waiting. */
  withinDays: z.number().int().min(1).max(30),
});
export type ShortStockParameters = z.infer<typeof shortStockParameters>;

export const SHORT_STOCK_RULE: RuleDefinition<ShortStockParameters> = {
  id: "dispensing.short-stock",
  version: 1,
  domain: "prescription",
  title: "Waiting prescriptions that stock cannot fill",
  description:
    "On the pharmacy screen: medicines on active prescriptions issued at this facility in the days you set and not fully dispensed, whose usable stock here (items named like the medicine, in the prescribed unit) is less than what is left to dispense. Matched by name and strength only; it orders nothing.",
  surfaces: ["pharmacy"],
  requires: [...REQUIRES],
  parametersSchema: shortStockParameters,
  defaultParameters: { withinDays: 3 },
  parameterLabels: {
    withinDays: { label: "Prescriptions issued in the last", unit: "days", min: 1, max: 30 },
  },
  reads:
    "Active prescriptions issued at the facility in the days you set with something left to dispense (medicine names, strengths, units, quantities and prescription numbers), and the facility's stock of items named like them (names, units, lots and quantities). Never a patient.",
  knownFalsePositives: [
    "Patients who fill their prescriptions elsewhere still count: the shortfall assumes every waiting prescription is dispensed here.",
    "Stock held under a brand-only or differently spelled name is not counted when another item does match, so the medicine looks shorter than it is.",
    "Deliveries on open purchase orders and transfers on their way are not counted.",
  ],
  blindSpots: ["Refills: only one fill of each prescription is counted.", "Medicines not stocked here, or stocked in another unit, are skipped."],
};

/** A prescription item still to be dispensed at the moment. */
export interface PendingItem {
  prescriptionId: string;
  prescriptionNumber: string;
  /** ISO instant. */
  issuedAt: string;
  genericName: string;
  strength: string | null;
  quantityUnit: string;
  /** Left to dispense in the prescribed unit (more than 0). */
  remaining: number;
}

/** An item the facility stocks (it has had stock at one of its locations), whether or not any is usable now. */
export interface StockedItem {
  itemId: string;
  itemName: string;
  stockUnit: string;
}

export function shortStockSuggestions(
  input: { pending: PendingItem[]; stocked: StockedItem[]; lots: UsableLot[] },
  params: ShortStockParameters,
  timeZone: string,
): Suggestion[] {
  const groups = new Map<string, PendingItem[]>();
  for (const item of input.pending) {
    if (item.remaining <= 0) continue;
    const key = [
      medicineWords(item.genericName).sort().join("-"),
      strengthKey(item.strength) ?? strengthKey(item.genericName) ?? "any",
      unitKey(item.quantityUnit),
    ].join(":");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: Suggestion[] = [];
  for (const [key, items] of groups) {
    const first = items[0]!;
    const matched = input.stocked.filter((s) => sameUnit(s.stockUnit, first.quantityUnit) && stockMatches(s.itemName, first));
    // Not stocked here in the prescribed unit: patients get it elsewhere, or units cannot be compared.
    if (matched.length === 0) continue;
    const lots = input.lots.filter((l) => l.quantity > 0 && matched.some((s) => s.itemId === l.itemId));
    const needed = items.reduce((sum, i) => sum + i.remaining, 0);
    const inStock = lots.reduce((sum, l) => sum + l.quantity, 0);
    if (needed <= inStock) continue;
    const places = new Map<string, { lot: UsableLot; quantity: number }>();
    for (const lot of lots) {
      const placeKey = `${lot.itemId}:${lot.locationId}`;
      places.set(placeKey, { lot, quantity: (places.get(placeKey)?.quantity ?? 0) + lot.quantity });
    }
    const stockEvidence: SuggestionEvidence[] = [
      ...[...places.values()].map(({ lot, quantity }) => ({
        label: `${lot.itemName} at ${lot.locationName}`,
        resourceType: "inventory_item",
        resourceId: lot.itemId,
        value: `${number(quantity)} ${lot.stockUnit}`,
      })),
      // Items stocked here with nothing usable left.
      ...matched
        .filter((s) => !lots.some((l) => l.itemId === s.itemId))
        .map((s) => ({ label: s.itemName, resourceType: "inventory_item", resourceId: s.itemId, value: "none usable here" })),
    ].sort((a, b) => a.label.localeCompare(b.label));
    const unit = first.quantityUnit;
    out.push({
      id: suggestionId(SHORT_STOCK_RULE.id, SHORT_STOCK_RULE.version, `medicine:${key}`),
      ruleId: SHORT_STOCK_RULE.id,
      ruleVersion: SHORT_STOCK_RULE.version,
      surface: "pharmacy",
      severity: inStock === 0 ? "warning" : "advice",
      title: `${medicineLabel(first)}: ${number(needed)} ${unit} left to dispense on ${items.length} prescription${items.length === 1 ? "" : "s"}, ${number(inStock)} in stock`,
      rationale:
        `Active prescriptions issued here in the last ${params.withinDays} day${params.withinDays === 1 ? "" : "s"} still need ${number(needed)} ${unit}; the usable stock here of the items named like it is ${number(inStock)}. ` +
        "Order or transfer more, dispense part now, or tell the patients where else to get it. Matched by name and strength: check the item before dispensing.",
      evidence: [
        ...stockEvidence,
        ...items.slice(0, 10).map((i) => ({
          label: i.prescriptionNumber,
          resourceType: "prescription",
          resourceId: i.prescriptionId,
          value: `${number(i.remaining)} ${i.quantityUnit} left, issued ${localDate(new Date(i.issuedAt), timeZone)}`,
        })),
      ],
      basis: "rule",
      strength: "matched",
      requires: [...SHORT_STOCK_RULE.requires],
      action: { label: "Open the stock", href: "/inventory" },
    });
  }
  return out;
}

// ---- dispensing.course-expiry ----------------------------------------------------------------------------------------

export const courseExpiryParameters = z.object({
  /** Stock must stay usable this many days after the course's last day. */
  marginDays: z.number().int().min(0).max(90),
});
export type CourseExpiryParameters = z.infer<typeof courseExpiryParameters>;

export const COURSE_EXPIRY_RULE: RuleDefinition<CourseExpiryParameters> = {
  id: "dispensing.course-expiry",
  version: 1,
  domain: "prescription",
  title: "Stock that expires before the course ends",
  description:
    "On a prescription being dispensed: for each medicine with a duration still to dispense, the stock here named like it whose lot taken first (the earliest expiry) expires before the course would end if handed over today. It shows each location's first lot, so the pharmacist can dispense from another location, hand over less, or tell the patient. Matched by name and strength only.",
  surfaces: ["pharmacy"],
  requires: [...REQUIRES],
  parametersSchema: courseExpiryParameters,
  defaultParameters: { marginDays: 0 },
  parameterLabels: {
    marginDays: {
      label: "Also when it expires within",
      unit: "days after the course ends",
      min: 0,
      max: 90,
      hint: "0 points out only stock that expires before the course's last day.",
    },
  },
  reads:
    "The prescription being dispensed (medicine names, strengths, durations and what is left to dispense), and the stock here named like each medicine, per location, with its lots' expiry dates and quantities.",
  knownFalsePositives: [
    "A first lot holding only a few units: the rule speaks though most of the course would come from later lots.",
    "A course the patient will not take in full from this fill, such as a partial hand-over or a course stopped early.",
  ],
  blindSpots: [
    "Items without a duration, lots without an expiry date, and stock named differently from the prescription.",
    "Refills: only one fill's course is checked.",
  ],
};

/** A prescription item as the course check reads it. */
export interface DispensingItem {
  prescriptionItemId: string;
  genericName: string;
  strength: string | null;
  durationValue: number | null;
  durationUnit: "days" | "weeks" | "months" | null;
  /** Left to dispense in the prescribed unit; null when not known (something was dispensed in another unit). */
  remaining: number | null;
}

/** Stock one prescription item could come from: one item at one location, with its lots. */
export interface StockCandidate {
  prescriptionItemId: string;
  locationId: string;
  locationName: string;
  itemId: string;
  itemName: string;
  lots: Array<{ lotNumber: string | null; expiryDate: string | null; quantity: number }>;
}

/** For each prescription item, the stock named like it, per location and item (any stock unit). */
export function stockCandidates(items: readonly DispensingItem[], lots: readonly UsableLot[]): StockCandidate[] {
  const out = new Map<string, StockCandidate>();
  for (const item of items) {
    for (const lot of lots) {
      if (lot.quantity <= 0 || !stockMatches(lot.itemName, item)) continue;
      const key = `${item.prescriptionItemId}:${lot.locationId}:${lot.itemId}`;
      const candidate = out.get(key) ?? {
        prescriptionItemId: item.prescriptionItemId,
        locationId: lot.locationId,
        locationName: lot.locationName,
        itemId: lot.itemId,
        itemName: lot.itemName,
        lots: [],
      };
      candidate.lots.push({ lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, quantity: lot.quantity });
      out.set(key, candidate);
    }
  }
  return [...out.values()];
}

/** The lot dispensing takes first: the earliest expiry, lots without one last (inventory's first-expiry-first-out). */
export function firstLot<L extends { lotNumber: string | null; expiryDate: string | null; quantity: number }>(lots: readonly L[]): L | undefined {
  return [...lots]
    .filter((l) => l.quantity > 0)
    .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || (a.lotNumber ?? "").localeCompare(b.lotNumber ?? ""))[0];
}

export interface CourseExpiryInput {
  prescriptionId: string;
  prescriptionNumber: string;
  /** The local day the stock is handed over (YYYY-MM-DD). */
  day: string;
  items: DispensingItem[];
  candidates: StockCandidate[];
}

export function courseExpirySuggestions(input: CourseExpiryInput, params: CourseExpiryParameters): Suggestion[] {
  const out: Suggestion[] = [];
  for (const item of input.items) {
    if (item.remaining === 0 || !item.durationValue || !item.durationUnit) continue;
    const courseDays = item.durationValue * DURATION_DAYS[item.durationUnit];
    const lastDay = addDays(input.day, courseDays - 1);
    const limit = addDays(lastDay, params.marginDays);
    const checked = input.candidates
      .filter((c) => c.prescriptionItemId === item.prescriptionItemId)
      .map((c) => ({ candidate: c, lot: firstLot(c.lots) }))
      .filter((c): c is { candidate: StockCandidate; lot: StockCandidate["lots"][number] } => c.lot !== undefined)
      .map((c) => ({ ...c, short: c.lot.expiryDate !== null && c.lot.expiryDate < limit }))
      .sort((a, b) => a.candidate.locationName.localeCompare(b.candidate.locationName) || a.candidate.itemName.localeCompare(b.candidate.itemName));
    const short = checked.filter((c) => c.short);
    if (short.length === 0) continue;
    const label = medicineLabel(item);
    const one = short.length === 1 ? short[0]! : null;
    const title = one
      ? `${label}: the lot taken first at ${one.candidate.locationName} expires ${one.lot.expiryDate}, before this ${courseDays}-day course ends (${lastDay})`
      : `${label}: the lots taken first at ${short.length} places expire before this ${courseDays}-day course ends (${lastDay})`;
    const elsewhere = checked.length > short.length;
    out.push({
      id: suggestionId(COURSE_EXPIRY_RULE.id, COURSE_EXPIRY_RULE.version, `prescription:${input.prescriptionId}:item:${item.prescriptionItemId}`),
      ruleId: COURSE_EXPIRY_RULE.id,
      ruleVersion: COURSE_EXPIRY_RULE.version,
      surface: "pharmacy",
      severity: elsewhere ? "advice" : "warning",
      title,
      rationale:
        `Stock is taken earliest expiry first, so the patient would receive stock that expires before the course of ${input.prescriptionNumber} ends on ${lastDay}${params.marginDays > 0 ? ` (or within ${params.marginDays} days after)` : ""}. ` +
        (elsewhere ? "Another place's first lot lasts the course: dispense from there, " : "No stock here lasts the course: ") +
        "hand over only what is needed before the expiry, or tell the patient the expiry date. Matched by name and strength: check the item.",
      evidence: checked.map((c) => ({
        label: `${c.candidate.itemName} at ${c.candidate.locationName}`,
        resourceType: "inventory_item",
        resourceId: c.candidate.itemId,
        value:
          c.lot.expiryDate === null
            ? "no expiry recorded"
            : `first lot${c.lot.lotNumber ? ` ${c.lot.lotNumber}` : ""} expires ${c.lot.expiryDate}${c.short ? "" : " (lasts the course)"}`,
      })),
      basis: "rule",
      strength: "matched",
      requires: [...COURSE_EXPIRY_RULE.requires],
    });
  }
  return out;
}
