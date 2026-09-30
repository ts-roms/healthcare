"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { parsePesos } from "@/lib/billing-mapping";
import { createProcurementMethod, createWithholdingCode, deactivateComplianceEntry } from "../actions";

type Result = { ok: true } | { ok: false; message: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        done?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, run };
}

/** Adds one of the organization's withholding codes (the rate is shown for reference only). */
export function NewWithholdingCode() {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ code: "", description: "", rate: "" });
  // A percentage with up to two decimals is basis points the same way pesos are centavos (1.5 → 150).
  const rate = f.rate.trim() ? parsePesos(f.rate) : null;
  return (
    <form
      className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createWithholdingCode({ code: f.code, description: f.description, rateBasisPoints: rate }),
          "Withholding code added",
          () => setF({ code: "", description: "", rate: "" }),
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="wh-code">Code</Label>
        <Input id="wh-code" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="wh-description">Description</Label>
        <Input id="wh-description" maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="wh-rate">Rate % (reference)</Label>
        <Input id="wh-rate" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
      </div>
      <Button type="submit" disabled={pending || !f.code.trim() || f.description.trim().length < 3 || (f.rate.trim() !== "" && rate === null)}>
        Add
      </Button>
    </form>
  );
}

/** Adds one of the organization's procurement methods and the reference an order under it needs. */
export function NewProcurementMethod() {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ code: "", name: "", referenceLabel: "" });
  return (
    <form
      className="grid gap-2 sm:grid-cols-[8rem_1fr_12rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createProcurementMethod({ code: f.code, name: f.name, referenceLabel: f.referenceLabel.trim() || null }),
          "Procurement method added",
          () => setF({ code: "", name: "", referenceLabel: "" }),
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="pm-code">Code</Label>
        <Input id="pm-code" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pm-name">Name</Label>
        <Input id="pm-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pm-reference">Reference asked for (optional)</Label>
        <Input
          id="pm-reference"
          maxLength={60}
          placeholder="e.g. Posting reference"
          value={f.referenceLabel}
          onChange={(e) => setF({ ...f, referenceLabel: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={pending || !f.code.trim() || f.name.trim().length < 3}>
        Add
      </Button>
    </form>
  );
}

export function DeactivateButton({ kind, id, label }: { kind: "withholding-codes" | "procurement-methods"; id: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      aria-label={`Stop using ${label}`}
      onClick={() => run(() => deactivateComplianceEntry({ kind, id }), "No longer in use")}
    >
      Stop using
    </Button>
  );
}
