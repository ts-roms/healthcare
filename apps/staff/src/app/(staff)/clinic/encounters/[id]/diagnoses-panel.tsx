"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { CodingSystem, DiagnosisView } from "@/lib/api/types";
import { diagnosisLabel, sortDiagnoses } from "@/lib/encounter-mapping";
import { label } from "@/lib/patient-mapping";
import { addDiagnosis, setDiagnosisStatus } from "../actions";

type StatusChange = { id: string; status: "resolved" | "entered_in_error" };
type DiagnosisForm = { display: string; codeSystemKey: string; code: string; certainty: "provisional" | "confirmed"; isChronic: boolean; reason: string };

export function DiagnosesPanel({
  encounterId,
  diagnoses,
  codingSystems,
  canEdit,
  needsReason,
}: {
  encounterId: string;
  diagnoses: DiagnosisView[];
  codingSystems: CodingSystem[];
  canEdit: boolean;
  /** The encounter is signed: every change is an amendment with a reason. */
  needsReason: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const hasPrimary = diagnoses.some((d) => d.rank === "primary" && d.status === "active");
  const blank: DiagnosisForm = { display: "", codeSystemKey: codingSystems[0]?.key ?? "", code: "", certainty: "provisional", isChronic: false, reason: "" };
  const [form, setForm] = React.useState<DiagnosisForm>(blank);
  const [rank, setRank] = React.useState<"primary" | "secondary">(hasPrimary ? "secondary" : "primary");
  const [adding, setAdding] = React.useState(false);
  const [change, setChange] = React.useState<StatusChange | null>(null);
  const [changeReason, setChangeReason] = React.useState("");

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await addDiagnosis({
        encounterId,
        display: form.display,
        code: form.code.trim() || undefined,
        codeSystemKey: form.code.trim() ? form.codeSystemKey || undefined : undefined,
        rank,
        certainty: form.certainty,
        isChronic: form.isChronic,
        amendmentReason: needsReason ? form.reason : undefined,
      });
      if (result.ok) {
        toast.success(`Diagnosis added: ${diagnosisLabel(result.data)}`);
        setForm(blank);
        setRank("secondary");
        setAdding(false);
        router.refresh();
      } else toast.error(result.message);
    });
  };

  const submitChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!change) return;
    startTransition(async () => {
      const result = await setDiagnosisStatus({ encounterId, diagnosisId: change.id, status: change.status, reason: changeReason });
      if (result.ok) {
        toast.success(change.status === "resolved" ? "Diagnosis marked resolved" : "Diagnosis marked entered in error");
        setChange(null);
        setChangeReason("");
        router.refresh();
      } else toast.error(result.message);
    });
  };

  return (
    <section aria-labelledby="dx-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id="dx-heading" className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          Diagnoses
        </h3>
        {canEdit && !adding ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setAdding(true)}>
            <PlusIcon /> Add diagnosis
          </Button>
        ) : null}
      </div>
      {diagnoses.length === 0 ? <p className="text-table text-muted-foreground">No diagnosis recorded.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {sortDiagnoses(diagnoses).map((d) => (
          <li key={d.id} className="rounded-md border bg-card px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={d.status === "entered_in_error" ? "text-muted-foreground line-through" : "font-medium"}>{diagnosisLabel(d)}</span>
              {d.rank === "primary" ? <Badge variant="info">Primary</Badge> : null}
              <Badge variant={d.certainty === "confirmed" ? "success" : "neutral"}>{label(d.certainty)}</Badge>
              {d.isChronic ? <Badge variant="teal">Chronic</Badge> : null}
              {d.status !== "active" ? <Badge variant="warning">{label(d.status)}</Badge> : null}
              {canEdit && d.status === "active" ? (
                <span className="ml-auto flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setChange({ id: d.id, status: "resolved" })}>
                    Resolve…
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setChange({ id: d.id, status: "entered_in_error" })}>
                    Entered in error…
                  </Button>
                </span>
              ) : null}
            </div>
            {d.statusReason ? <p className="text-meta text-muted-foreground">Reason: {d.statusReason}</p> : null}
            {change?.id === d.id ? (
              <form onSubmit={submitChange} className="mt-1.5 flex flex-wrap items-end gap-2">
                <div className="grid min-w-56 flex-1 gap-1">
                  <Label htmlFor={`dx-reason-${d.id}`}>{change.status === "resolved" ? "Why is it resolved?" : "Why was it entered in error?"} *</Label>
                  <Input id={`dx-reason-${d.id}`} autoFocus maxLength={500} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant={change.status === "resolved" ? "default" : "destructive"}
                  disabled={pending || changeReason.trim().length < 3}
                >
                  Confirm
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChange(null)}>
                  Cancel
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {adding ? (
        <form onSubmit={submitAdd} className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6">
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor="dx-display">Diagnosis *</Label>
            <Input id="dx-display" autoFocus maxLength={300} value={form.display} onChange={(e) => setForm({ ...form, display: e.target.value })} />
          </div>
          {codingSystems.length > 0 ? (
            <>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor="dx-system">Code system</Label>
                <NativeSelect id="dx-system" value={form.codeSystemKey} onChange={(e) => setForm({ ...form, codeSystemKey: e.target.value })}>
                  {codingSystems.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                      {c.version ? ` (${c.version})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor="dx-code">Code</Label>
                <Input id="dx-code" className="font-mono" maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
            </>
          ) : (
            <p className="text-meta text-muted-foreground sm:col-span-6">
              No code system is in use; the diagnosis is recorded as text. A clinic administrator registers one under Clinic → Coding systems.
            </p>
          )}
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="dx-rank">Rank</Label>
            <NativeSelect id="dx-rank" value={rank} onChange={(e) => setRank(e.target.value as "primary" | "secondary")}>
              <option value="primary" disabled={hasPrimary}>
                Primary{hasPrimary ? " (already set)" : ""}
              </option>
              <option value="secondary">Secondary</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="dx-certainty">Certainty</Label>
            <NativeSelect
              id="dx-certainty"
              value={form.certainty}
              onChange={(e) => setForm({ ...form, certainty: e.target.value as "provisional" | "confirmed" })}
            >
              <option value="provisional">Provisional</option>
              <option value="confirmed">Confirmed</option>
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 self-end pb-1.5 text-table sm:col-span-2">
            <Checkbox checked={form.isChronic} onCheckedChange={(v) => setForm({ ...form, isChronic: v === true })} /> Chronic condition
          </label>
          {needsReason ? (
            <div className="grid gap-1 sm:col-span-6">
              <Label htmlFor="dx-reason">Amendment reason * (the encounter is signed)</Label>
              <Input id="dx-reason" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending || !form.display.trim() || (needsReason && form.reason.trim().length < 3)}>
              Add diagnosis
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
