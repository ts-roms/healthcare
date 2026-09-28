"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, CheckCircle2Icon, FlaskRoundIcon, HistoryIcon, PlusIcon, TriangleAlertIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
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
import type {
  LabAvailableReagentLot,
  LabCatalogEntry,
  LabInstrument,
  LabInstrumentEventKind,
  LabInstrumentLogEntry,
  LabReagentLoad,
  LabTest,
} from "@/lib/api/types";
import { createInstrument, loadInstrumentLog, loadReagentHistory, loadReagentLot, logInstrument, unloadReagentLot } from "../quality-actions";

const KIND_LABEL: Record<LabInstrumentEventKind, string> = {
  maintenance: "Maintenance",
  calibration: "Calibration",
  repair: "Repair",
  verification: "Verification",
  out_of_service: "Out of service",
  returned_to_service: "Returned to service",
  retired: "Retired",
};

const STATUS: Record<LabInstrument["status"], { label: string; variant: "success" | "danger" | "neutral"; icon: typeof CheckCircle2Icon }> = {
  active: { label: "In service", variant: "success", icon: CheckCircle2Icon },
  out_of_service: { label: "Out of service", variant: "danger", icon: XCircleIcon },
  retired: { label: "Retired", variant: "neutral", icon: XCircleIcon },
};

/** Which log entries apply to an instrument in a status (retiring also needs lab.qc.manage). */
function kindsFor(status: LabInstrument["status"], canManage: boolean): LabInstrumentEventKind[] {
  if (status === "retired") return [];
  const kinds: LabInstrumentEventKind[] = ["maintenance", "calibration", "verification", "repair"];
  kinds.push(status === "active" ? "out_of_service" : "returned_to_service");
  if (canManage) kinds.push("retired");
  return kinds;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });
  return { pending, run };
}

export function InstrumentRegister({
  instruments,
  departments,
  reagents,
  availableLots,
  tests,
  includeRetired,
  canLog,
  canManage,
}: {
  instruments: LabInstrument[];
  departments: LabCatalogEntry[];
  /** Reagent lots loaded now at the facility. */
  reagents: LabReagentLoad[];
  availableLots: LabAvailableReagentLot[];
  tests: LabTest[];
  includeRetired: boolean;
  canLog: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Instruments</CardTitle>
          <Link href={includeRetired ? "/laboratory/instruments" : "/laboratory/instruments?show=retired"} className="text-meta text-primary hover:underline">
            {includeRetired ? "Hide retired" : "Show retired"}
          </Link>
        </CardHeader>
        <CardContent>
          {instruments.length === 0 ? (
            <p className="text-body text-muted-foreground">No instruments registered at this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Calibration</TableHead>
                  <TableHead>Maintenance</TableHead>
                  <TableHead>Reagent lots</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {instruments.map((i) => {
                  const status = STATUS[i.status];
                  const Icon = status.icon;
                  return (
                    <React.Fragment key={i.id}>
                      <TableRow data-state={open === i.id ? "selected" : undefined}>
                        <TableCell>
                          <span className="font-medium">{i.name}</span>
                          <span className="block text-meta text-muted-foreground">
                            {[
                              i.code,
                              i.manufacturer,
                              i.model,
                              i.serialNumber ? `SN ${i.serialNumber}` : null,
                              departments.find((d) => d.id === i.departmentId)?.name,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>
                            <Icon aria-hidden /> {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-table">
                          {i.lastCalibration ? (
                            <>
                              {clinicalDate(i.lastCalibration.performedAt)} · {i.lastCalibration.outcome === "fail" ? "failed" : "passed"}
                              {i.lastCalibration.nextDueOn ? (
                                <span className={`block text-meta ${i.calibrationOverdue ? "font-medium text-warning-foreground" : "text-muted-foreground"}`}>
                                  {i.calibrationOverdue ? <CalendarClockIcon className="mr-1 inline size-3.5" aria-hidden /> : null}
                                  {i.calibrationOverdue ? "Overdue since" : "Next due"} {clinicalDate(i.lastCalibration.nextDueOn)}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </TableCell>
                        <TableCell className="text-table">
                          {i.lastMaintenance ? (
                            <>
                              {clinicalDate(i.lastMaintenance.performedAt)}
                              {i.lastMaintenance.nextDueOn ? (
                                <span className="block text-meta text-muted-foreground">Next due {clinicalDate(i.lastMaintenance.nextDueOn)}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </TableCell>
                        <TableCell className="text-table">
                          <ReagentSummary loads={reagents.filter((r) => r.instrumentId === i.id)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="xs" variant="outline" onClick={() => setOpen(open === i.id ? null : i.id)}>
                            <HistoryIcon /> {open === i.id ? "Close" : "Log"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open === i.id ? (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 whitespace-normal">
                            <ReagentPanel
                              instrument={i}
                              loads={reagents.filter((r) => r.instrumentId === i.id)}
                              availableLots={availableLots}
                              tests={tests}
                              canLog={canLog}
                            />
                            <InstrumentLog instrument={i} canLog={canLog} canManage={canManage} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canManage ? <NewInstrument departments={departments} /> : null}
    </div>
  );
}

function InstrumentLog({ instrument, canLog, canManage }: { instrument: LabInstrument; canLog: boolean; canManage: boolean }) {
  const { pending, run } = useRun();
  const [entries, setEntries] = React.useState<LabInstrumentLogEntry[] | null>(null);
  const [reload, setReload] = React.useState(0);
  const kinds = kindsFor(instrument.status, canManage);
  const [f, setF] = React.useState({ kind: kinds[0] ?? "maintenance", outcome: "", nextDueOn: "", notes: "" });
  React.useEffect(() => {
    let active = true;
    void loadInstrumentLog(instrument.id).then((result) => {
      if (!active) return;
      if (result.ok) setEntries(result.data);
      else toast.error(result.message);
    });
    return () => {
      active = false;
    };
  }, [instrument.id, reload]);
  const needsOutcome = f.kind === "calibration" || f.kind === "verification";
  const needsNotes = f.kind === "out_of_service" || f.kind === "retired" || f.kind === "repair";

  return (
    <div className="flex flex-col gap-3 p-1">
      {canLog && kinds.length ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                logInstrument({
                  instrumentId: instrument.id,
                  kind: f.kind as LabInstrumentEventKind,
                  outcome: needsOutcome || f.outcome ? (f.outcome as "pass" | "fail") || undefined : undefined,
                  nextDueOn: f.nextDueOn || undefined,
                  notes: f.notes,
                }),
              `${KIND_LABEL[f.kind as LabInstrumentEventKind]} recorded`,
              () => {
                setF({ kind: "maintenance", outcome: "", nextDueOn: "", notes: "" });
                setReload((n) => n + 1);
              },
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`kind-${instrument.id}`}>Record</Label>
            <NativeSelect id={`kind-${instrument.id}`} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LabInstrumentEventKind })}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {needsOutcome ? (
            <div className="grid gap-1">
              <Label htmlFor={`outcome-${instrument.id}`}>Outcome *</Label>
              <NativeSelect id={`outcome-${instrument.id}`} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
                <option value="">Choose…</option>
                <option value="pass">Passed</option>
                <option value="fail">Failed</option>
              </NativeSelect>
            </div>
          ) : null}
          {f.kind === "maintenance" || f.kind === "calibration" ? (
            <div className="grid gap-1">
              <Label htmlFor={`due-${instrument.id}`}>Next due</Label>
              <Input id={`due-${instrument.id}`} type="date" value={f.nextDueOn} onChange={(e) => setF({ ...f, nextDueOn: e.target.value })} />
            </div>
          ) : null}
          <div className="grid min-w-56 flex-1 gap-1">
            <Label htmlFor={`notes-${instrument.id}`}>Notes{needsNotes ? " *" : ""}</Label>
            <Input id={`notes-${instrument.id}`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />
          </div>
          <Button type="submit" size="sm" disabled={pending || (needsOutcome && !f.outcome) || (needsNotes && !f.notes.trim())}>
            <WrenchIcon /> Record
          </Button>
        </form>
      ) : null}
      {entries === null ? <p className="text-meta text-muted-foreground">Loading log…</p> : null}
      {entries?.length === 0 ? <p className="text-meta text-muted-foreground">Nothing recorded yet.</p> : null}
      {entries?.length ? (
        <ul className="flex flex-col gap-1 text-table">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="tabular">{clinicalDateTime(e.performedAt)}</span> · <span className="font-medium">{KIND_LABEL[e.kind]}</span>
              {e.outcome ? ` · ${e.outcome === "pass" ? "passed" : "failed"}` : ""}
              {e.nextDueOn ? ` · next due ${clinicalDate(e.nextDueOn)}` : ""}
              {e.notes ? ` · ${e.notes}` : ""}
              <span className="text-meta text-muted-foreground"> — {e.recordedByName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReagentSummary({ loads }: { loads: LabReagentLoad[] }) {
  if (loads.length === 0) return <span className="text-muted-foreground">None loaded</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {loads.map((l) => (
        <li key={l.id} className={l.expired ? "font-medium text-danger-foreground" : undefined}>
          {l.expired ? <TriangleAlertIcon className="mr-1 inline size-3.5" aria-hidden /> : null}
          {l.itemName} · lot {l.lotNumber ?? "—"}
          {l.expired ? " (expired)" : ""}
        </li>
      ))}
    </ul>
  );
}

/** Reagent lots loaded on the instrument: load a lot from inventory stock (replaces the lot of the same reagent), unload, history. */
function ReagentPanel({
  instrument,
  loads,
  availableLots,
  tests,
  canLog,
}: {
  instrument: LabInstrument;
  loads: LabReagentLoad[];
  availableLots: LabAvailableReagentLot[];
  tests: LabTest[];
  canLog: boolean;
}) {
  const { pending, run } = useRun();
  const [f, setF] = React.useState({ inventoryLotId: "", testId: "" });
  const [unloading, setUnloading] = React.useState<{ loadId: string; reason: string } | null>(null);
  const [history, setHistory] = React.useState<LabReagentLoad[] | null>(null);
  const canLoad = canLog && instrument.status !== "retired";

  return (
    <div className="mb-3 flex flex-col gap-2 border-b p-1 pb-3">
      <p className="flex items-center gap-1.5 text-table font-medium">
        <FlaskRoundIcon className="size-4" aria-hidden /> Reagent lots in use
      </p>
      <p className="text-meta text-muted-foreground">
        QC runs and patient results on this instrument record the lots in use. Loading a new lot of the same reagent replaces the current one, and — depending
        on the facility&apos;s QC policy — QC must be run again before results are covered.
      </p>
      {loads.length === 0 ? <p className="text-meta text-muted-foreground">No reagent lot loaded.</p> : null}
      <ul className="flex flex-col gap-1 text-table">
        {loads.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2">
            <span className={l.expired ? "font-medium text-danger-foreground" : undefined}>
              {l.itemName} · lot {l.lotNumber ?? "—"}
              {l.expiryDate ? ` · expires ${clinicalDate(l.expiryDate)}` : ""}
            </span>
            {l.expired ? (
              <Badge variant="danger">
                <TriangleAlertIcon aria-hidden /> Expired — QC and results refused
              </Badge>
            ) : null}
            <span className="text-meta text-muted-foreground">
              {l.testName ? `for ${l.testName}` : "all tests"} · loaded {clinicalDateTime(l.loadedAt)} by {l.loadedByName}
            </span>
            {canLog ? (
              unloading?.loadId === l.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () => unloadReagentLot(unloading),
                      "Lot unloaded",
                      () => setUnloading(null),
                    );
                  }}
                >
                  <Input
                    aria-label="Reason for unloading"
                    placeholder="Why (e.g. used up, expired)"
                    value={unloading.reason}
                    onChange={(e) => setUnloading({ ...unloading, reason: e.target.value })}
                    maxLength={500}
                    className="h-7 w-56"
                  />
                  <Button type="submit" size="xs" disabled={pending || unloading.reason.trim().length < 3}>
                    Unload
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setUnloading(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setUnloading({ loadId: l.id, reason: "" })}>
                  Unload…
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {canLoad ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => loadReagentLot({ instrumentId: instrument.id, inventoryLotId: f.inventoryLotId, testId: f.testId || undefined }),
              "Reagent lot loaded",
              () => setF({ inventoryLotId: "", testId: "" }),
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`reagent-${instrument.id}`}>Load a lot from stock</Label>
            <NativeSelect id={`reagent-${instrument.id}`} value={f.inventoryLotId} onChange={(e) => setF({ ...f, inventoryLotId: e.target.value })}>
              <option value="">{availableLots.length ? "Choose a reagent lot…" : "No reagent lots in stock at this facility"}</option>
              {availableLots.map((l) => (
                <option key={l.lotId} value={l.lotId}>
                  {l.itemName} · lot {l.lotNumber ?? "—"}
                  {l.expiryDate ? ` · exp. ${clinicalDate(l.expiryDate)}` : ""} · {l.quantity} {l.stockUnit}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`reagent-test-${instrument.id}`}>For</Label>
            <NativeSelect id={`reagent-test-${instrument.id}`} value={f.testId} onChange={(e) => setF({ ...f, testId: e.target.value })}>
              <option value="">All tests on this instrument</option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" size="sm" disabled={pending || !f.inventoryLotId}>
            <PlusIcon /> Load lot
          </Button>
        </form>
      ) : null}
      <div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            history ? setHistory(null) : void loadReagentHistory(instrument.id).then((r) => (r.ok ? setHistory(r.data) : toast.error(r.message)))
          }
        >
          <HistoryIcon /> {history ? "Hide lot history" : "Lot history"}
        </Button>
        {history ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-meta">
            {history.map((l) => (
              <li key={l.id}>
                {l.itemName} · lot {l.lotNumber ?? "—"} ({l.testName ?? "all tests"}): loaded {clinicalDateTime(l.loadedAt)} by {l.loadedByName}
                {l.unloadedAt ? ` · unloaded ${clinicalDateTime(l.unloadedAt)} by ${l.unloadedByName} — ${l.unloadReason}` : " · in use"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function NewInstrument({ departments }: { departments: LabCatalogEntry[] }) {
  const { pending, run } = useRun();
  const empty = { code: "", name: "", departmentId: "", manufacturer: "", model: "", serialNumber: "" };
  const [f, setF] = React.useState(empty);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Register an instrument</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createInstrument({ ...f, departmentId: f.departmentId || undefined }),
              "Instrument registered",
              () => setF(empty),
            );
          }}
        >
          <Input aria-label="Code" placeholder="Code, e.g. chem-1" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <NativeSelect aria-label="Department" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
            <option value="">Department (optional)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label="Manufacturer" placeholder="Manufacturer" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />
          <Input aria-label="Model" placeholder="Model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <Input aria-label="Serial number" placeholder="Serial number" value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} />
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            <PlusIcon /> Register
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
