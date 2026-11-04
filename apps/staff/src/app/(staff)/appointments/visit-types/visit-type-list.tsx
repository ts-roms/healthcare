"use client";

import * as React from "react";
import { GlobeIcon, LockIcon, MonitorSmartphoneIcon } from "lucide-react";
import { Button, Checkbox, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { VisitType } from "@/lib/api/types";
import { type RunServerAction, useServerAction } from "@/lib/use-server-action";
import { BLANK_VISIT_TYPE, VISIT_TYPE_MODALITIES } from "@/lib/visit-type-form";
import { createVisitType, deactivateVisitType, setKioskEnabled, setOnlineBooking } from "../actions";

export function VisitTypeList({ visitTypes, canConfigure }: { visitTypes: VisitType[]; canConfigure: boolean }) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });

  const toggle = (type: VisitType, onlineBooking: boolean) =>
    run(
      () => setOnlineBooking({ visitTypeId: type.id, onlineBooking, version: type.version }),
      `${type.name} is ${onlineBooking ? "open" : "closed"} for online booking`,
    );

  const toggleKiosk = (type: VisitType, kioskEnabled: boolean) =>
    run(
      () => setKioskEnabled({ visitTypeId: type.id, kioskEnabled, version: type.version }),
      `${type.name} is ${kioskEnabled ? "offered" : "no longer offered"} at the patient kiosk`,
    );

  const deactivate = (type: VisitType) => {
    if (!window.confirm(`Deactivate ${type.name}? It can no longer be booked or used for check-ins; appointments and visits already recorded keep it.`)) return;
    run(() => deactivateVisitType({ visitTypeId: type.id, version: type.version }), `${type.name} is now inactive`);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Visit type</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Online booking</TableHead>
            <TableHead>Patient kiosk</TableHead>
            {canConfigure ? <TableHead className="sr-only">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visitTypes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canConfigure ? 7 : 6} className="text-muted-foreground">
                No visit types yet. {canConfigure ? "Add one below." : "Ask a clinic administrator to add one."}
              </TableCell>
            </TableRow>
          ) : null}
          {visitTypes.map((type) => (
            <TableRow key={type.id}>
              <TableCell className="font-medium">
                {type.name} <span className="text-meta font-normal text-muted-foreground">({type.code})</span>
              </TableCell>
              <TableCell>{type.modality === "telemedicine" ? "Online (video)" : "In person"}</TableCell>
              <TableCell className="tabular-nums">{type.defaultDurationMinutes} min</TableCell>
              <TableCell>{type.status === "active" ? "Active" : "Inactive"}</TableCell>
              <TableCell>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={type.onlineBooking}
                    disabled={!canConfigure || pending || type.status !== "active"}
                    onCheckedChange={(checked) => toggle(type, checked === true)}
                    aria-label={`Patients may book ${type.name} online`}
                  />
                  {type.onlineBooking ? (
                    <span className="flex items-center gap-1">
                      <GlobeIcon className="size-3.5" aria-hidden /> Patients can book
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <LockIcon className="size-3.5" aria-hidden /> Staff only
                    </span>
                  )}
                </label>
              </TableCell>
              <TableCell>
                {type.modality === "telemedicine" ? (
                  <span className="text-muted-foreground">Not for online visits</span>
                ) : (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={type.kioskEnabled}
                      disabled={!canConfigure || pending || type.status !== "active"}
                      onCheckedChange={(checked) => toggleKiosk(type, checked === true)}
                      aria-label={`Offer ${type.name} at the patient kiosk`}
                    />
                    {type.kioskEnabled ? (
                      <span className="flex items-center gap-1">
                        <MonitorSmartphoneIcon className="size-3.5" aria-hidden /> Offered at the kiosk
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not at the kiosk</span>
                    )}
                  </label>
                )}
              </TableCell>
              {canConfigure ? (
                <TableCell className="text-right">
                  {type.status === "active" ? (
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => deactivate(type)}>
                      Deactivate…
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canConfigure ? (
        <AddVisitType pending={pending} run={run} />
      ) : (
        <p className="text-table text-muted-foreground">Only clinic administrators can change these settings.</p>
      )}
    </div>
  );
}

/** Adds a visit type (clinic.configure). The API validates and audits; the code can never change afterwards. */
function AddVisitType({ pending, run }: { pending: boolean; run: RunServerAction }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(BLANK_VISIT_TYPE);
  const set = (key: "code" | "name" | "defaultDurationMinutes") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Add a visit type…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createVisitType(form),
          "Visit type added",
          () => {
            setForm(BLANK_VISIT_TYPE);
            setOpen(false);
          },
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="visit-type-name">Name</Label>
          <Input id="visit-type-name" required maxLength={120} placeholder="e.g. Consultation" value={form.name} onChange={set("name")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="visit-type-code">Code</Label>
          <Input
            id="visit-type-code"
            required
            minLength={2}
            maxLength={49}
            pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,48}"
            title="2–49 letters, digits or hyphens"
            placeholder="e.g. consult"
            autoCapitalize="none"
            value={form.code}
            onChange={set("code")}
          />
          <p className="text-meta text-muted-foreground">Letters, digits or hyphens; cannot be changed later.</p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="visit-type-where">Where</Label>
          <NativeSelect
            id="visit-type-where"
            value={form.modality}
            onChange={(e) =>
              setForm((f) => ({ ...f, modality: e.target.value as typeof f.modality, kioskEnabled: e.target.value === "in_person" ? f.kioskEnabled : false }))
            }
          >
            {VISIT_TYPE_MODALITIES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="visit-type-duration">Usual length (minutes)</Label>
          <Input
            id="visit-type-duration"
            type="number"
            min={5}
            max={480}
            step={1}
            required
            value={form.defaultDurationMinutes}
            onChange={set("defaultDurationMinutes")}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-body">
        <Checkbox
          checked={form.requiresTriage}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, requiresTriage: checked === true }))}
          aria-label="Patients go through triage before the consultation"
        />
        Triage before the consultation
      </label>
      <label className="flex items-center gap-2 text-body">
        <Checkbox
          checked={form.onlineBooking}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, onlineBooking: checked === true }))}
          aria-label="Patients may book this visit type online"
        />
        Patients may book it themselves in MyHealth
      </label>
      {form.modality === "in_person" ? (
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={form.kioskEnabled}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, kioskEnabled: checked === true }))}
            aria-label="Offer this visit type at the patient kiosk"
          />
          Offer it at the patient kiosk (walk-in check-in)
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add visit type"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
