"use client";

import * as React from "react";
import { Button, Input, Label, NativeSelect } from "@healthcare/ui/primitives";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";
import { useServerAction } from "@/lib/use-server-action";
import { endRetentionPolicy, setRetentionPolicy } from "./actions";

/** Set a category's retention period from the organization's own schedule (replaces the current one, kept as history). */
export function RetentionPolicyForm() {
  const { pending, run } = useServerAction();
  const [f, setF] = React.useState({ category: "", retainYears: "", basisNote: "" });
  return (
    <form
      className="grid gap-2 sm:grid-cols-[14rem_7rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => setRetentionPolicy({ category: f.category, retainYears: Number.parseInt(f.retainYears || "0", 10), basisNote: f.basisNote }),
          "Retention period saved",
          () => setF({ category: "", retainYears: "", basisNote: "" }),
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="ret-category">Document category</Label>
        <NativeSelect placeholder="Choose…" id="ret-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ret-years">Keep for (years)</Label>
        <Input id="ret-years" inputMode="numeric" value={f.retainYears} onChange={(e) => setF({ ...f, retainYears: e.target.value.replace(/\D/g, "") })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ret-basis">Where the period comes from</Label>
        <Input
          id="ret-basis"
          maxLength={500}
          placeholder="e.g. Our retention schedule, approved by the DPO"
          value={f.basisNote}
          onChange={(e) => setF({ ...f, basisNote: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={pending || !f.category || !f.retainYears || f.basisNote.trim().length < 3}>
        Save
      </Button>
    </form>
  );
}

export function EndPolicyButton({ category }: { category: string }) {
  const { pending, run } = useServerAction();
  return (
    <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => endRetentionPolicy({ category }), "Retention period removed")}>
      Remove
    </Button>
  );
}
