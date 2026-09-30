"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { ComplianceArea } from "@/lib/api/types";
import { recordComplianceReview } from "./actions";

/** Record who reviewed one area's configuration against current official requirements. */
export function ComplianceReviewForm({ area, today }: { area: ComplianceArea; today: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    outcome: "validated" as "validated" | "changes_needed",
    reviewerName: "",
    reviewerRole: "",
    reference: "",
    reviewedOn: today,
    note: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record a review…
      </Button>
    );
  }
  const id = (name: string) => `${area}-${name}`;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await recordComplianceReview({ area, ...form });
          if (result.ok) {
            toast.success("Review recorded");
            setOpen(false);
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={id("outcome")}>Outcome</Label>
          <NativeSelect id={id("outcome")} value={form.outcome} onChange={set("outcome")}>
            <option value="validated">Validated</option>
            <option value="changes_needed">Changes needed</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("date")}>Reviewed on</Label>
          <Input id={id("date")} type="date" max={today} value={form.reviewedOn} onChange={set("reviewedOn")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("name")}>Reviewer</Label>
          <Input id={id("name")} maxLength={120} value={form.reviewerName} onChange={set("reviewerName")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("role")}>Role</Label>
          <Input
            id={id("role")}
            maxLength={120}
            placeholder="e.g. External accountant, Data Protection Officer"
            value={form.reviewerRole}
            onChange={set("reviewerRole")}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={id("reference")}>Reviewed against</Label>
        <Textarea
          id={id("reference")}
          rows={2}
          maxLength={500}
          placeholder="The issuances or engagement, as the reviewer wrote them"
          value={form.reference}
          onChange={set("reference")}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={id("note")}>Note (optional)</Label>
        <Textarea id={id("note")} rows={2} maxLength={1000} value={form.note} onChange={set("note")} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save review
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
