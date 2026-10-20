"use client";

import * as React from "react";
import { CheckCircle2Icon, MinusCircleIcon, PencilIcon } from "lucide-react";
import { Badge, Button, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { ServicePoint, ServicePointKind } from "@/lib/api/types";
import { SERVICE_POINT_KIND_LABEL } from "@/lib/clinic-mapping";
import { useServerAction } from "@/lib/use-server-action";
import { createServicePoint, updateServicePoint } from "./actions";

const KINDS = Object.keys(SERVICE_POINT_KIND_LABEL) as ServicePointKind[];

interface Form {
  code: string;
  name: string;
  kind: ServicePointKind;
  location: string;
}

const EMPTY: Form = { code: "", name: "", kind: "consultation", location: "" };

/** The facility's service points: add, rename, change the kind, deactivate or reactivate (the code never changes). */
export function ServicePointList({ facilityId, servicePoints }: { facilityId: string; servicePoints: ServicePoint[] }) {
  const [editing, setEditing] = React.useState<ServicePoint | null>(null);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const { pending, run } = useServerAction();
  const reset = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      run(
        () => updateServicePoint(editing.id, { name: form.name, kind: form.kind, location: form.location, version: editing.version }),
        `${form.name.trim()} updated`,
        reset,
      );
    } else {
      run(() => createServicePoint({ facilityId, ...form }), `${form.name.trim()} added`, reset);
    }
  };
  const toggle = (s: ServicePoint) =>
    run(
      () => updateServicePoint(s.id, { status: s.status === "active" ? "inactive" : "active", version: s.version }),
      s.status === "active" ? `${s.name} deactivated` : `${s.name} is in use again`,
    );

  return (
    <div className="flex flex-col gap-4 p-4">
      {servicePoints.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service point</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servicePoints.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-meta">{s.code}</TableCell>
                <TableCell>{SERVICE_POINT_KIND_LABEL[s.kind]}</TableCell>
                <TableCell>{s.location ?? <span className="text-muted-foreground">— (the name)</span>}</TableCell>
                <TableCell>
                  {s.status === "active" ? (
                    <Badge variant="success">
                      <CheckCircle2Icon aria-hidden /> In use
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <MinusCircleIcon aria-hidden /> Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setEditing(s);
                      setForm({ code: s.code, name: s.name, kind: s.kind, location: s.location ?? "" });
                    }}
                  >
                    <PencilIcon aria-hidden /> Edit
                  </Button>
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => toggle(s)}>
                    {s.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No service points set up. Patients stay on the facility&apos;s single consultation line.</p>
      )}

      <form onSubmit={submit} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6" aria-label={editing ? "Edit service point" : "Add a service point"}>
        <h2 className="text-body font-semibold sm:col-span-6">{editing ? `Edit ${editing.name}` : "Add a service point"}</h2>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="service-point-code">Code *</Label>
          <Input
            id="service-point-code"
            required
            disabled={!!editing}
            placeholder="e.g. er, xray, opd"
            pattern="[a-z0-9][a-z0-9\-]{1,48}"
            maxLength={49}
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="service-point-name">Name *</Label>
          <Input
            id="service-point-name"
            required
            maxLength={120}
            placeholder="e.g. Emergency room"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="service-point-kind">Kind *</Label>
          <NativeSelect id="service-point-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ServicePointKind }))}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {SERVICE_POINT_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1 sm:col-span-3">
          <Label htmlFor="service-point-location">Location (what the display says)</Label>
          <Input
            id="service-point-location"
            maxLength={60}
            placeholder="e.g. Laboratory, 2nd floor"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </div>
        <p className="text-meta text-muted-foreground sm:col-span-6">
          The kind only labels and orders the service point on the queue and at triage; it adds no rule. The code cannot change once added. The location is what
          the waiting-room display shows and reads out when a route sends a patient here; the name is used when it is empty.
        </p>
        <div className="flex gap-2 sm:col-span-6">
          <Button type="submit" size="sm" disabled={pending || form.name.trim().length < 1 || (!editing && form.code.trim().length < 2)}>
            {editing ? "Save changes" : "Add service point"}
          </Button>
          {editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
