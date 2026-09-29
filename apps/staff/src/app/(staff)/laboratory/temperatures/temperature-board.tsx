"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon, ClockIcon, HistoryIcon, PlusIcon, ThermometerIcon, TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@healthcare/ui/primitives";
import type { LabStorageUnit, LabTemperatureReading, StorageUnitKind } from "@/lib/api/types";
import { createStorageUnit, loadTemperatureReadings, recordTemperature, setStorageUnitStatus } from "../quality-management-actions";
import { useRun } from "../quality-ui";

const KIND_LABEL: Record<StorageUnitKind, string> = {
  refrigerator: "Refrigerator",
  freezer: "Freezer",
  incubator: "Incubator",
  water_bath: "Water bath",
  room: "Room",
  other: "Other",
};

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

export function TemperatureBoard({ units, canRecord, canManage }: { units: LabStorageUnit[]; canRecord: boolean; canManage: boolean }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const active = units.filter((u) => u.status === "active");
  const retired = units.filter((u) => u.status === "retired");
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Storage units</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="text-body text-muted-foreground">No storage units registered at this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Last reading</TableHead>
                  <TableHead>Excursions (7 days)</TableHead>
                  <TableHead className="w-80">{canRecord ? "Record a reading" : ""}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((u) => (
                  <React.Fragment key={u.id}>
                    <TableRow data-state={open === u.id ? "selected" : undefined}>
                      <TableCell>
                        <span className="font-medium">{u.name}</span>
                        <span className="block text-meta text-muted-foreground">
                          {u.code} · {KIND_LABEL[u.kind]}
                          {u.readingIntervalHours ? ` · every ${u.readingIntervalHours} h` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-table">
                        {u.minCelsius} to {u.maxCelsius} °C
                      </TableCell>
                      <TableCell className="text-table">
                        {u.lastReading ? (
                          <span className={u.lastReading.outOfRange ? "font-medium text-danger-foreground" : undefined}>
                            {u.lastReading.outOfRange ? <TriangleAlertIcon className="mr-1 inline size-3.5" aria-hidden /> : null}
                            {u.lastReading.celsius} °C
                            <span className="block text-meta text-muted-foreground">{clinicalDateTime(u.lastReading.readAt)}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">None yet</span>
                        )}
                        {u.readingDue ? (
                          <Badge variant="warning" className="mt-1">
                            <ClockIcon aria-hidden /> Reading due
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {u.excursionsLast7Days ? (
                          <Badge variant="danger">
                            <TriangleAlertIcon aria-hidden /> {u.excursionsLast7Days}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-table text-muted-foreground">
                            <CheckCircle2Icon className="size-4 text-success" aria-hidden /> None
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {canRecord ? <ReadingForm unit={u} /> : null}
                          <Button size="xs" variant="ghost" className="self-start" onClick={() => setOpen(open === u.id ? null : u.id)}>
                            <HistoryIcon /> {open === u.id ? "Hide readings" : "Readings"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {open === u.id ? (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 whitespace-normal">
                          <Readings unit={u} canManage={canManage} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
          {retired.length ? <p className="mt-2 text-meta text-muted-foreground">Retired: {retired.map((u) => u.name).join(", ")}</p> : null}
        </CardContent>
      </Card>
      {canManage ? <NewUnit /> : null}
    </div>
  );
}

function ReadingForm({ unit }: { unit: LabStorageUnit }) {
  const { pending, run } = useRun();
  const [celsius, setCelsius] = React.useState("");
  const [note, setNote] = React.useState("");
  const value = num(celsius);
  const outside = Number.isFinite(value) && (value < unit.minCelsius || value > unit.maxCelsius);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => recordTemperature({ unitId: unit.id, celsius: value, note }),
          outside ? "Excursion recorded — nonconformance opened" : "Reading recorded",
          () => {
            setCelsius("");
            setNote("");
          },
        );
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          aria-label={`Temperature of ${unit.name} in °C`}
          placeholder="°C"
          inputMode="decimal"
          className="h-8 w-20"
          value={celsius}
          onChange={(e) => setCelsius(e.target.value)}
        />
        <Button type="submit" size="xs" disabled={pending || !Number.isFinite(value) || (outside && note.trim().length < 3)}>
          <ThermometerIcon /> Record
        </Button>
      </div>
      {outside ? (
        <Input
          aria-label="What was seen and done"
          placeholder="Outside the range: what was seen and done *"
          className="h-8"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
      ) : null}
    </form>
  );
}

function Readings({ unit, canManage }: { unit: LabStorageUnit; canManage: boolean }) {
  const { pending, run } = useRun();
  const [rows, setRows] = React.useState<LabTemperatureReading[] | null>(null);
  const [retiring, setRetiring] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    void loadTemperatureReadings(unit.id).then((r) => {
      if (!active) return;
      if (r.ok) setRows(r.data);
      else toast.error(r.message);
    });
    return () => {
      active = false;
    };
  }, [unit.id, unit.lastReading?.readAt]);
  return (
    <div className="flex flex-col gap-2 p-1">
      {rows === null ? <p className="text-meta text-muted-foreground">Loading…</p> : null}
      {rows?.length === 0 ? <p className="text-meta text-muted-foreground">No readings in the last 31 days.</p> : null}
      {rows?.length ? (
        <ul className="flex flex-col gap-0.5 text-table">
          {[...rows].reverse().map((r) => (
            <li key={r.id} className={r.outOfRange ? "text-danger-foreground" : undefined}>
              <span className="tabular">{clinicalDateTime(r.readAt)}</span> · <span className="font-medium">{r.celsius} °C</span>
              {r.outOfRange ? ` · outside ${r.minCelsius} to ${r.maxCelsius} °C` : ""}
              {r.note ? ` · ${r.note}` : ""}
              <span className="text-meta text-muted-foreground"> — {r.recordedByName}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        retiring === null ? (
          <Button size="xs" variant="ghost" className="self-start" onClick={() => setRetiring("")}>
            Retire unit…
          </Button>
        ) : (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setStorageUnitStatus({ unitId: unit.id, status: "retired", reason: retiring, version: unit.version }), "Unit retired");
            }}
          >
            <Input aria-label="Reason" placeholder="Why it is retired" className="h-8 w-72" value={retiring} onChange={(e) => setRetiring(e.target.value)} />
            <Button type="submit" size="xs" variant="destructive" disabled={pending || retiring.trim().length < 3}>
              Retire
            </Button>
          </form>
        )
      ) : null}
      <p className="text-meta text-muted-foreground">
        Excursions open nonconformances: see{" "}
        <Link href="/laboratory/nonconformances" className="text-primary hover:underline">
          Nonconformances
        </Link>
        .
      </p>
    </div>
  );
}

function NewUnit() {
  const { pending, run } = useRun();
  const empty = { code: "", name: "", kind: "refrigerator" as StorageUnitKind, minCelsius: "", maxCelsius: "", readingIntervalHours: "" };
  const [f, setF] = React.useState(empty);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a storage unit</CardTitle>
        <p className="text-meta text-muted-foreground">
          Set the acceptable range from the manufacturer&apos;s requirements and your laboratory&apos;s procedures.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createStorageUnit({
                  code: f.code,
                  name: f.name,
                  kind: f.kind,
                  minCelsius: num(f.minCelsius),
                  maxCelsius: num(f.maxCelsius),
                  readingIntervalHours: f.readingIntervalHours ? Number(f.readingIntervalHours) : undefined,
                }),
              "Storage unit registered",
              () => setF(empty),
            );
          }}
        >
          <Input aria-label="Code" placeholder="Code, e.g. fridge-1" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <NativeSelect aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as StorageUnitKind })}>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <div className="grid gap-1">
            <Label htmlFor="unit-min">Lowest acceptable (°C)</Label>
            <Input id="unit-min" inputMode="decimal" value={f.minCelsius} onChange={(e) => setF({ ...f, minCelsius: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="unit-max">Highest acceptable (°C)</Label>
            <Input id="unit-max" inputMode="decimal" value={f.maxCelsius} onChange={(e) => setF({ ...f, maxCelsius: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="unit-interval">Reading every (hours, optional)</Label>
            <Input
              id="unit-interval"
              inputMode="numeric"
              value={f.readingIntervalHours}
              onChange={(e) => setF({ ...f, readingIntervalHours: e.target.value })}
            />
          </div>
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            <PlusIcon /> Register
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
