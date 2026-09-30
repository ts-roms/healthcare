import type { SupplyUse, SupplyUseLine } from "./api/types";

// Supplies a procedure used, taken from inventory: shared by dental procedures and clinic procedures (both issue through
// inventory's own rules and return unused supplies explicitly). Pure helpers for the screens.

type Variant = "success" | "warning" | "danger" | "neutral" | "info" | "teal";

export interface SupplyDraftLine {
  itemId: string;
  quantity: number;
  /** Needed with the reference for controlled items (inventory refuses them otherwise). */
  reason: string;
  reference: string;
}

/** The draft as the API request lines (reason and reference only when given). */
export function supplyRequestLines(draft: readonly SupplyDraftLine[]) {
  return draft.map((l) => ({
    itemId: l.itemId,
    quantity: l.quantity,
    ...(l.reason.trim() ? { reason: l.reason.trim() } : {}),
    ...(l.reference.trim() ? { reference: l.reference.trim() } : {}),
  }));
}

/** A procedure's supply uses, oldest first, and its issued lines that still have something out (returnable). */
export function procedureSupplies(uses: readonly SupplyUse[], procedureId: string) {
  const mine = uses.filter((u) => u.procedureId === procedureId).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const returnable = mine
    .filter((u) => u.kind === "issue")
    .flatMap((u) => u.lines.filter((l) => (l.outstanding ?? 0) > 0).map((l) => ({ ...l, useId: u.id, locationId: u.locationId })));
  return { uses: mine, returnable };
}

/** An issued line's state in words (with an icon name chosen by the screen): used, partly returned, returned. */
export function supplyLineState(line: Pick<SupplyUseLine, "quantity" | "outstanding">): {
  label: string;
  variant: Variant;
  kind: "used" | "partial" | "returned";
} {
  const out = line.outstanding ?? line.quantity;
  if (out === 0) return { label: "Returned", variant: "neutral", kind: "returned" };
  if (out < line.quantity) return { label: `${line.quantity - out} returned`, variant: "info", kind: "partial" };
  return { label: "Used", variant: "teal", kind: "used" };
}

/** Inline messages per item from an API refusal (stock short, controlled item details, invalid lines). */
export function supplyErrors(code: string | undefined, message: string, details: unknown): Record<string, string> {
  if (!details || typeof details !== "object") return {};
  const d = details as Record<string, unknown>;
  if (typeof d.itemId === "string") return { [d.itemId]: message };
  if (code === "invalid_supplies") {
    return Object.fromEntries(
      Object.entries(d)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, (v as string[]).join("; ")]),
    );
  }
  return {};
}

/** A template's supplies as the starting list; items no longer active are left out. Staff confirm or change it. */
export function draftFromTemplate(
  activeItemIds: Iterable<string>,
  template: ReadonlyArray<{ itemId: string; quantity: number }> | undefined,
): SupplyDraftLine[] {
  const active = new Set(activeItemIds);
  return (template ?? []).filter((i) => active.has(i.itemId)).map((i) => ({ itemId: i.itemId, quantity: i.quantity, reason: "", reference: "" }));
}
