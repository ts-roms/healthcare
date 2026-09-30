"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { recordLabLicence } from "./actions";

const FIELDS = [
  ["licenceNumber", "Licence number", 60],
  ["classification", "Classification (as written on the licence)", 120],
  ["issuedBy", "Issued by (as printed)", 160],
  ["headName", "Head of the laboratory", 160],
  ["headLicenceNumber", "Head's professional licence number", 40],
] as const;

/** Record the licence as issued; a renewal is recorded the same way (earlier licences stay in the history). */
export function LicenceForm() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({
    licenceNumber: "",
    classification: "",
    issuedBy: "",
    validFrom: "",
    validUntil: "",
    headName: "",
    headLicenceNumber: "",
    reminderDays: "60",
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await recordLabLicence({ ...f, reminderDays: Number.parseInt(f.reminderDays || "0", 10) });
          if (result.ok) {
            toast.success("Licence recorded");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      {FIELDS.map(([key, label, max]) => (
        <div key={key} className="grid gap-1">
          <Label htmlFor={`licence-${key}`}>{label}</Label>
          <Input id={`licence-${key}`} maxLength={max} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
        </div>
      ))}
      <div className="grid gap-1">
        <Label htmlFor="licence-from">Valid from</Label>
        <Input id="licence-from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="licence-until">Valid until</Label>
        <Input id="licence-until" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="licence-reminder">Remind this many days before it ends</Label>
        <Input
          id="licence-reminder"
          inputMode="numeric"
          value={f.reminderDays}
          onChange={(e) => setF({ ...f, reminderDays: e.target.value.replace(/\D/g, "") })}
        />
      </div>
      <Button type="submit" className="self-end justify-self-start" disabled={pending || !f.licenceNumber.trim() || !f.validFrom || !f.validUntil}>
        Record licence
      </Button>
    </form>
  );
}
