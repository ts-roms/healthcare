import type { CompareMode } from "@healthcare/core";
import type { FigureChange, FigureUnit } from "../../management-dashboard/management-dashboard.rules";
import type { AskScope } from "./ask.schema";

/**
 * An answer of the assistant's Ask (docs/domains/assistant.md, "Ask"): one sentence, the figures it rests on (with the
 * comparison when one was asked), how they are worked out and where the full figures are. Display text only, formatted
 * here so every screen says it the same way; never a patient.
 */
export type AskStatus = "answered" | "withheld" | "unavailable";

export interface AskRow {
  label: string;
  value: string;
  /** The same figure in the comparison period. */
  previous?: string;
  /** The change against the comparison period, in words; whether it is better is the dashboard's own rule. */
  change?: { text: string; direction: "up" | "down" | "flat"; assessment: "better" | "worse" | "unchanged" | "neutral" };
}

export interface AskAnswer {
  question: { id: string; version: number; title: string };
  status: AskStatus;
  sentence: string;
  period: { key: string; label: string; from: string; to: string; text: string } | null;
  comparison: { mode: CompareMode; label: string; from: string; to: string; text: string } | null;
  scope: { kind: AskScope; name: string };
  rows: AskRow[];
  notes: string[];
  /** How the figures are worked out (the source screen's own definitions). */
  definition: string | null;
  link: { label: string; href: string } | null;
  /** The person's own entry for this question among their questions (to save it); null when the answer was not kept. */
  entry: { id: string } | null;
}

const PHP = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

/** Centavos as pesos: "₱1,234.50". */
export const peso = (centavos: number) => PHP.format(centavos / 100);

export const count = (n: number) => n.toLocaleString("en-PH");

/** "45 min", "2 h 5 min". */
export function minutes(value: number): string {
  const total = Math.round(value);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A fraction as a percentage: 0.125 → "12.5%". */
export const percent = (rate: number) => `${(Math.round(rate * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;

/** A dashboard figure in words; "<5" stays as the dashboard masked it; null is "None recorded". */
export function formatFigure(unit: FigureUnit, value: number | "<5" | null): string {
  if (value === null) return "None recorded";
  if (value === "<5") return "fewer than 5";
  if (unit === "rate") return percent(value);
  if (unit === "minutes") return minutes(value);
  if (unit === "centavos") return peso(value);
  return count(value);
}

/** A change against the comparison period in words: "up 12% (8 more)", "down 2.5 points", "down ₱1,200.00 (4%)". */
export function changeText(figure: FigureChange): AskRow["change"] | undefined {
  const c = figure.change;
  if (!c) return undefined;
  if (c.direction === "flat") return { text: "no change", direction: "flat", assessment: c.assessment };
  const by = Math.abs(c.absolute);
  const relative = c.relative === null ? "" : ` (${percent(Math.abs(c.relative))})`;
  const amount =
    figure.unit === "rate"
      ? `${(Math.round(by * 1000) / 10).toFixed(1).replace(/\.0$/, "")} points`
      : figure.unit === "minutes"
        ? minutes(by)
        : figure.unit === "centavos"
          ? `${peso(by)}${relative}`
          : `${count(by)}${relative}`;
  return { text: `${c.direction} ${amount}`, direction: c.direction, assessment: c.assessment };
}
