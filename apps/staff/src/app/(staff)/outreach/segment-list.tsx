"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { OutreachSegment, OutreachSegmentCriteria, OutreachSegmentPreview } from "@/lib/api/types";
import { CHANNEL_LABEL, describeCriteria } from "@/lib/outreach-mapping";
import { archiveSegment, saveSegment } from "./actions";

export function SegmentList({ segments, canManage }: { segments: OutreachSegment[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<OutreachSegment | "new" | null>(null);
  const [preview, setPreview] = React.useState<{ id: string; data: OutreachSegmentPreview } | null>(null);

  const showPreview = (segment: OutreachSegment) =>
    startTransition(async () => {
      const response = await fetch(`/outreach/segments/${segment.id}/preview`, { cache: "no-store" });
      if (!response.ok) {
        toast.error("The preview could not be loaded.");
        return;
      }
      setPreview({ id: segment.id, data: (await response.json()) as OutreachSegmentPreview });
    });

  const archive = (segment: OutreachSegment) =>
    startTransition(async () => {
      const result = await archiveSegment(segment.id, segment.version);
      if (result.ok) {
        toast.success(`${segment.name} archived`);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Segments</CardTitle>
        {canManage && editing === null ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            New segment
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {segments.length === 0 ? (
          <p className="text-table text-muted-foreground">No segments yet. A segment is a saved list of patients that match the clinic&apos;s criteria.</p>
        ) : null}
        <ul className="flex flex-col divide-y">
          {segments.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-table">
              <div className="min-w-0">
                <p className="font-medium">
                  {s.name} {s.status === "archived" ? <Badge variant="neutral">Archived</Badge> : null}
                </p>
                <p className="text-muted-foreground">{describeCriteria(s.criteria)}</p>
                {s.description ? <p className="text-muted-foreground">{s.description}</p> : null}
                {preview?.id === s.id ? (
                  <div className="mt-2 rounded-md border p-2">
                    <p>
                      {preview.data.total} patient{preview.data.total === 1 ? "" : "s"} match today
                      {preview.data.truncated ? ` (first ${preview.data.members.length} shown)` : ""}.
                    </p>
                    {preview.data.members.length > 0 ? (
                      <ul className="mt-1 max-h-48 overflow-y-auto text-meta text-muted-foreground">
                        {preview.data.members.map((m) => (
                          <li key={m.patientId}>
                            {m.patientNumber} · {m.displayName} · {m.sex === "female" ? "F" : "M"} {m.age}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => showPreview(s)} disabled={pending}>
                  Preview
                </Button>
                {canManage && s.status === "active" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)} disabled={pending}>
                      Change
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => archive(s)} disabled={pending}>
                      Archive
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {editing !== null ? (
          <SegmentForm key={editing === "new" ? "new" : editing.id} segment={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SegmentForm({ segment, onDone }: { segment: OutreachSegment | null; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(segment?.name ?? "");
  const [description, setDescription] = React.useState(segment?.description ?? "");
  const [c, setC] = React.useState<Record<keyof OutreachSegmentCriteria, string>>({
    ageMin: str(segment?.criteria.ageMin),
    ageMax: str(segment?.criteria.ageMax),
    sex: segment?.criteria.sex ?? "",
    cityMunicipality: segment?.criteria.cityMunicipality ?? "",
    province: segment?.criteria.province ?? "",
    registeredFrom: segment?.criteria.registeredFrom ?? "",
    registeredTo: segment?.criteria.registeredTo ?? "",
    lastVisitBefore: segment?.criteria.lastVisitBefore ?? "",
    noVisitForMonths: str(segment?.criteria.noVisitForMonths),
    carePlanActivityDueWithinDays: str(segment?.criteria.carePlanActivityDueWithinDays),
    optedInChannel: segment?.criteria.optedInChannel ?? "",
  });
  const set = (key: keyof OutreachSegmentCriteria) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC({ ...c, [key]: e.target.value });
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-label={segment ? "Change segment" : "New segment"}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveSegment(
            {
              name,
              description,
              criteria: {
                ageMin: num(c.ageMin),
                ageMax: num(c.ageMax),
                sex: (c.sex || undefined) as "male" | "female" | undefined,
                cityMunicipality: c.cityMunicipality,
                province: c.province,
                registeredFrom: c.registeredFrom,
                registeredTo: c.registeredTo,
                lastVisitBefore: c.lastVisitBefore,
                noVisitForMonths: num(c.noVisitForMonths),
                carePlanActivityDueWithinDays: num(c.carePlanActivityDueWithinDays),
                optedInChannel: (c.optedInChannel || undefined) as OutreachSegmentCriteria["optedInChannel"],
              },
            },
            segment ? { id: segment.id, version: segment.version } : null,
          );
          if (result.ok) {
            toast.success(segment ? "Segment changed" : "Segment saved");
            onDone();
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="sg-name">Name</Label>
          <Input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="sg-desc">Description (optional)</Label>
          <Input id="sg-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="text-table font-medium">Who matches (every filled criterion must hold)</legend>
        <Field id="sg-age-min" label="Age from">
          <Input id="sg-age-min" type="number" min={0} max={120} value={c.ageMin} onChange={set("ageMin")} />
        </Field>
        <Field id="sg-age-max" label="Age to">
          <Input id="sg-age-max" type="number" min={0} max={120} value={c.ageMax} onChange={set("ageMax")} />
        </Field>
        <Field id="sg-sex" label="Sex">
          <NativeSelect id="sg-sex" value={c.sex} onChange={set("sex")}>
            <option value="">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </NativeSelect>
        </Field>
        <Field id="sg-city" label="City or municipality">
          <Input id="sg-city" value={c.cityMunicipality} onChange={set("cityMunicipality")} maxLength={120} />
        </Field>
        <Field id="sg-prov" label="Province">
          <Input id="sg-prov" value={c.province} onChange={set("province")} maxLength={120} />
        </Field>
        <Field id="sg-opt" label="Opted in to">
          <NativeSelect id="sg-opt" value={c.optedInChannel} onChange={set("optedInChannel")}>
            <option value="">Any</option>
            {(Object.keys(CHANNEL_LABEL) as Array<keyof typeof CHANNEL_LABEL>).map((ch) => (
              <option key={ch} value={ch}>
                {CHANNEL_LABEL[ch]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="sg-reg-from" label="Registered from">
          <Input id="sg-reg-from" type="date" value={c.registeredFrom} onChange={set("registeredFrom")} />
        </Field>
        <Field id="sg-reg-to" label="Registered to">
          <Input id="sg-reg-to" type="date" value={c.registeredTo} onChange={set("registeredTo")} />
        </Field>
        <Field id="sg-last" label="Last visit on or before">
          <Input id="sg-last" type="date" value={c.lastVisitBefore} onChange={set("lastVisitBefore")} />
        </Field>
        <Field id="sg-novisit" label="No visit for (months)">
          <Input id="sg-novisit" type="number" min={1} max={120} value={c.noVisitForMonths} onChange={set("noVisitForMonths")} />
        </Field>
        <Field id="sg-due" label="Care-plan activity due within (days)">
          <Input id="sg-due" type="number" min={0} max={365} value={c.carePlanActivityDueWithinDays} onChange={set("carePlanActivityDueWithinDays")} />
        </Field>
      </fieldset>
      <p className="text-meta text-muted-foreground">
        Deceased, merged and inactive records are never included. Nothing clinical (diagnoses, results, medications) can be chosen here.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || name.trim().length < 2}>
          {segment ? "Save changes" : "Save segment"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function str(v: number | undefined): string {
  return v === undefined ? "" : String(v);
}
