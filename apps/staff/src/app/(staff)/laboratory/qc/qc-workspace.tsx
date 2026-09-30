"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BanIcon, CheckCircle2Icon, LineChartIcon, PlusIcon, SendIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime, QcLeveyJenningsChart, QcStatusBadge } from "@healthcare/ui/healthcare";
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
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type { LabInstrument, LabQcBoard, LabQcMaterial, LabQcRun, LabTest } from "@/lib/api/types";
import { createQcLot, createQcMaterial, loadQcRuns, recordQcAction, recordQcRun, retireQcLot, setQcTarget } from "../quality-actions";

type Pair = { instrumentId: string; testId: string };

const RULE_LABEL: Record<string, string> = { "1_2s": "1-2s", "1_3s": "1-3s", "2_2s": "2-2s", R_4s: "R-4s", "4_1s": "4-1s", "10_x": "10-x" };
const rules = (violations: string[]) => violations.map((v) => RULE_LABEL[v] ?? v).join(", ");

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

/** Lots with a current target for a test on an instrument (what a control can be run with). */
function lotsFor(materials: LabQcMaterial[], pair: Partial<Pair>) {
  return materials.flatMap((m) =>
    m.lots
      .filter((l) => l.status === "active" && l.targets.some((t) => t.testId === pair.testId && t.instrumentId === pair.instrumentId))
      .map((l) => ({ ...l, material: m, target: l.targets.find((t) => t.testId === pair.testId && t.instrumentId === pair.instrumentId)! })),
  );
}

export function QcWorkspace({
  board,
  materials,
  instruments,
  tests,
  canEnter,
  canManage,
}: {
  board: LabQcBoard;
  materials: LabQcMaterial[];
  instruments: LabInstrument[];
  tests: LabTest[];
  canEnter: boolean;
  canManage: boolean;
}) {
  const [selected, setSelected] = React.useState<Pair | null>(
    board.rows[0] ? { instrumentId: board.rows[0].instrumentId, testId: board.rows[0].testId } : null,
  );
  const [version, setVersion] = React.useState(0);
  const lotName = (qcLotId: string) => {
    for (const m of materials) {
      const lot = m.lots.find((l) => l.id === qcLotId);
      if (lot) return `${m.level} · ${lot.lotNumber}`;
    }
    return "Control";
  };

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>QC status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-meta text-muted-foreground">
              Latest run of each control level within {board.policy.qcValidHours} h
              {board.policy.qcAfterReagentChange ? " (or since the newest reagent lot change)" : ""}. Rejecting rules: {rules(board.policy.qcRejectRules)} (1-2s
              warns).{" "}
              {board.policy.qcRequired ? <Badge variant="info">Patient results on an instrument need QC</Badge> : "Patient results are not blocked by QC."}{" "}
              <Link href="/laboratory/catalog" className="text-primary hover:underline">
                Facility policy
              </Link>
            </p>
            {board.rows.length === 0 ? (
              <p className="text-body text-muted-foreground">No QC targets yet. Register instruments, then set control lots and their targets below.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Test</TableHead>
                    <TableHead>Control levels</TableHead>
                    <TableHead>Patient results</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.rows.map((row) => {
                    const isSelected = selected?.instrumentId === row.instrumentId && selected.testId === row.testId;
                    return (
                      <TableRow key={`${row.instrumentId}:${row.testId}`} data-state={isSelected ? "selected" : undefined}>
                        <TableCell>
                          {row.instrumentName}
                          {row.instrumentStatus !== "active" ? <span className="block text-meta text-warning-foreground">Out of service</span> : null}
                        </TableCell>
                        <TableCell>
                          {row.testName}
                          {row.reagents.map((r) => (
                            <span key={r.loadId} className={`block text-meta ${r.expired ? "font-medium text-danger-foreground" : "text-muted-foreground"}`}>
                              {r.itemName} · lot {r.lotNumber ?? "—"}
                              {r.expired ? " (expired)" : ""}
                            </span>
                          ))}
                        </TableCell>
                        <TableCell>
                          {board.policy.qcAfterReagentChange && row.reagents.some((r) => r.loadedAt === row.qcSince) ? (
                            <span className="mb-1 block text-meta text-muted-foreground">Since the reagent lot change {clinicalDateTime(row.qcSince)}:</span>
                          ) : null}
                          {row.lots.length === 0 ? (
                            <QcStatusBadge status="none" />
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {row.lots.map((l) => (
                                <span key={l.qcLotId} className="inline-flex items-center gap-1 text-meta" title={clinicalDateTime(l.runAt)}>
                                  <QcStatusBadge status={l.status} />
                                  {lotName(l.qcLotId)}
                                  {l.violations.length ? ` (${rules(l.violations)})` : ""}
                                </span>
                              ))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.resultsAllowed ? (
                            <span className="inline-flex items-center gap-1 text-table">
                              <CheckCircle2Icon className="size-4 text-success" aria-hidden /> Allowed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-table font-medium text-danger-foreground">
                              <BanIcon className="size-4" aria-hidden /> Blocked
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="xs" variant="outline" onClick={() => setSelected({ instrumentId: row.instrumentId, testId: row.testId })}>
                            <LineChartIcon /> Chart
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <RunHistory
            key={`${selected.instrumentId}:${selected.testId}:${version}`}
            pair={selected}
            instrumentName={instruments.find((i) => i.id === selected.instrumentId)?.name ?? "Instrument"}
            test={tests.find((t) => t.id === selected.testId)}
            canEnter={canEnter}
          />
        ) : null}

        {canManage ? <QcSetup materials={materials} instruments={instruments} tests={tests} /> : <MaterialsList materials={materials} />}
      </div>

      {canEnter ? (
        <RecordRun
          materials={materials}
          instruments={instruments.filter((i) => i.status === "active")}
          tests={tests}
          onRecorded={(pair) => {
            setSelected(pair);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function RecordRun({
  materials,
  instruments,
  tests,
  onRecorded,
}: {
  materials: LabQcMaterial[];
  instruments: LabInstrument[];
  tests: LabTest[];
  onRecorded: (pair: Pair) => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [f, setF] = React.useState({ instrumentId: instruments[0]?.id ?? "", testId: "", qcLotId: "", value: "", comment: "" });
  const [last, setLast] = React.useState<LabQcRun | null>(null);
  const testsWithTargets = tests.filter((t) => lotsFor(materials, { instrumentId: f.instrumentId, testId: t.id }).length > 0);
  const lots = lotsFor(materials, f);
  const lot = lots.find((l) => l.id === f.qcLotId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await recordQcRun({ ...f, value: f.value.trim() === "" ? Number.NaN : Number(f.value), comment: f.comment });
      if (!result.ok) return void toast.error(result.message);
      setLast(result.data);
      const message = result.data.status === "accepted" ? "QC accepted" : `QC ${result.data.status}: ${rules(result.data.violations)}`;
      if (result.data.status === "rejected") toast.error(`${message}. Do not report patient results on this test until QC is resolved.`, { duration: 15_000 });
      else if (result.data.status === "warning") toast.warning(message);
      else toast.success(message);
      setF((s) => ({ ...s, value: "", comment: "" }));
      onRecorded({ instrumentId: f.instrumentId, testId: f.testId });
      router.refresh();
    });
  };

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>Record a control</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <div className="grid gap-1">
            <Label htmlFor="qc-instrument">Instrument</Label>
            <NativeSelect
              emptyText="No active instruments"
              id="qc-instrument"
              value={f.instrumentId}
              onChange={(e) => setF({ ...f, instrumentId: e.target.value, testId: "", qcLotId: "" })}
            >
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qc-test">Test</Label>
            <NativeSelect id="qc-test" value={f.testId} onChange={(e) => setF({ ...f, testId: e.target.value, qcLotId: "" })}>
              <option value="">{testsWithTargets.length ? "Choose…" : "No targets on this instrument"}</option>
              {testsWithTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qc-lot">Control lot</Label>
            <NativeSelect placeholder="Choose…" id="qc-lot" value={f.qcLotId} onChange={(e) => setF({ ...f, qcLotId: e.target.value })} disabled={!f.testId}>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.material.name} {l.material.level} · lot {l.lotNumber} (exp. {clinicalDate(l.expiresOn)})
                </option>
              ))}
            </NativeSelect>
            {lot ? (
              <p className="text-meta text-muted-foreground">
                Target {lot.target.mean} ± {lot.target.sd} {lot.target.unit ?? ""}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qc-value">Value</Label>
            <Input id="qc-value" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </div>
          <Input
            aria-label="Comment"
            placeholder="Comment (optional)"
            value={f.comment}
            onChange={(e) => setF({ ...f, comment: e.target.value })}
            maxLength={1000}
          />
          <Button type="submit" size="sm" className="self-start" disabled={pending || !f.qcLotId || !f.value.trim()}>
            <SendIcon /> Record control
          </Button>
          {last ? (
            <p className="flex flex-wrap items-center gap-1.5 text-meta" role="status">
              Last: <QcStatusBadge status={last.status} /> {last.value} ({last.zScore > 0 ? "+" : ""}
              {last.zScore} SD){last.violations.length ? ` · ${rules(last.violations)}` : ""}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function RunHistory({ pair, instrumentName, test, canEnter }: { pair: Pair; instrumentName: string; test: LabTest | undefined; canEnter: boolean }) {
  const [runs, setRuns] = React.useState<LabQcRun[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    void loadQcRuns(pair.instrumentId, pair.testId).then((result) => {
      if (!active) return;
      if (result.ok) setRuns(result.data);
      else setError(result.message);
    });
    return () => {
      active = false;
    };
  }, [pair.instrumentId, pair.testId, reload]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {test?.name ?? "Test"} · {instrumentName}
        </CardTitle>
        <p className="text-meta text-muted-foreground">Last 31 days.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <p className="text-body text-danger-foreground">{error}</p> : null}
        {runs === null && !error ? <p className="text-body text-muted-foreground">Loading…</p> : null}
        {runs && runs.length === 0 ? <p className="text-body text-muted-foreground">No QC runs in the last 31 days.</p> : null}
        {runs && runs.length ? (
          <>
            <QcLeveyJenningsChart
              name={test?.name ?? "QC"}
              unit={test?.unit ? ` ${test.unit}` : undefined}
              points={runs.map((r) => ({
                id: r.id,
                runAt: r.runAt,
                z: r.zScore,
                value: r.value,
                status: r.status,
                violations: r.violations,
                series: `${r.level} · lot ${r.lotNumber}`,
              }))}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Evaluation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...runs].reverse().map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular text-table">
                      {clinicalDateTime(r.runAt)}
                      <span className="block text-meta text-muted-foreground">{r.enteredByName}</span>
                    </TableCell>
                    <TableCell className="text-table">
                      {r.level} · {r.lotNumber}
                    </TableCell>
                    <TableCell className="tabular">
                      {r.value}{" "}
                      <span className="text-meta text-muted-foreground">
                        ({r.zScore > 0 ? "+" : ""}
                        {r.zScore} SD; target {r.targetMean} ± {r.targetSd})
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <span className="flex flex-wrap items-center gap-1">
                          <QcStatusBadge status={r.status} />
                          {r.violations.length ? <span className="text-meta">{rules(r.violations)}</span> : null}
                        </span>
                        {r.comment ? <span className="text-meta text-muted-foreground">{r.comment}</span> : null}
                        {r.reagents.length ? (
                          <span className="text-meta text-muted-foreground">
                            Reagent: {r.reagents.map((g) => `${g.itemName} lot ${g.lotNumber ?? "—"}`).join(", ")}
                          </span>
                        ) : null}
                        {r.actions.map((a) => (
                          <span key={a.id} className="text-meta">
                            Action: {a.action} <span className="text-muted-foreground">— {a.recordedByName}</span>
                          </span>
                        ))}
                        {canEnter && r.status !== "accepted" ? <ActionForm runId={r.id} onDone={() => setReload((n) => n + 1)} /> : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActionForm({ runId, onDone }: { runId: string; onDone: () => void }) {
  const { pending, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <PlusIcon /> Corrective action
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => recordQcAction({ runId, action: text }),
          "Corrective action recorded",
          () => {
            setOpen(false);
            setText("");
            onDone();
          },
        );
      }}
    >
      <Textarea
        aria-label="Corrective action"
        placeholder="Cause found and what was done"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
      />
      <div className="flex gap-1">
        <Button type="submit" size="xs" disabled={pending || text.trim().length < 3}>
          Save
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MaterialsList({ materials }: { materials: LabQcMaterial[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Control materials</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {materials.length === 0 ? <p className="text-body text-muted-foreground">No control materials yet.</p> : null}
        {materials.map((m) => (
          <MaterialBlock key={m.id} material={m} />
        ))}
      </CardContent>
    </Card>
  );
}

function MaterialBlock({ material, children }: { material: LabQcMaterial; children?: (lotId: string) => React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-table font-medium">
        {material.name} · {material.level} <span className="font-mono text-meta text-muted-foreground">{material.code}</span>
      </p>
      {material.lots.length === 0 ? <p className="text-meta text-muted-foreground">No lots.</p> : null}
      {material.lots.map((l) => (
        <div key={l.id} className="mt-1 border-t pt-1 text-meta">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Lot {l.lotNumber}</span> expires {clinicalDate(l.expiresOn)}
            {l.status === "retired" ? <Badge variant="neutral">Retired</Badge> : null}
            {children?.(l.id)}
          </p>
          {l.targets.map((t) => (
            <p key={t.id} className="text-muted-foreground">
              {t.testName} on {t.instrumentName}: {t.mean} ± {t.sd} {t.unit ?? ""}
              {t.source ? ` (${t.source})` : ""}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function QcSetup({ materials, instruments, tests }: { materials: LabQcMaterial[]; instruments: LabInstrument[]; tests: LabTest[] }) {
  const { pending, run } = useRun();
  const [material, setMaterial] = React.useState({ code: "", name: "", level: "", manufacturer: "" });
  const [lot, setLot] = React.useState({ materialId: "", lotNumber: "", expiresOn: "" });
  const [target, setTarget] = React.useState({ qcLotId: "", testId: "", instrumentId: "", mean: "", sd: "", source: "" });
  const activeLots = materials.flatMap((m) =>
    m.lots.filter((l) => l.status === "active").map((l) => ({ ...l, label: `${m.name} ${m.level} · lot ${l.lotNumber}` })),
  );
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Control materials, lots and targets</CardTitle>
        <p className="text-meta text-muted-foreground">
          A new target for the same lot, test and instrument replaces the current one from now on; runs keep the target they were read against.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {materials.map((m) => (
            <MaterialBlock key={m.id} material={m}>
              {(lotId) =>
                m.lots.find((l) => l.id === lotId)?.status === "active" ? (
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => retireQcLot(lotId), "Lot retired")}>
                    Retire lot
                  </Button>
                ) : null
              }
            </MaterialBlock>
          ))}
        </div>

        <form
          className="grid gap-2 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createQcMaterial(material),
              "Control material added",
              () => setMaterial({ code: "", name: "", level: "", manufacturer: "" }),
            );
          }}
        >
          <p className="text-table font-medium sm:col-span-5">New control material</p>
          <Input
            aria-label="Code"
            placeholder="Code, e.g. chem-l1"
            value={material.code}
            onChange={(e) => setMaterial({ ...material, code: e.target.value })}
          />
          <Input aria-label="Name" placeholder="Name" value={material.name} onChange={(e) => setMaterial({ ...material, name: e.target.value })} />
          <Input
            aria-label="Level"
            placeholder="Level, e.g. Level 1"
            value={material.level}
            onChange={(e) => setMaterial({ ...material, level: e.target.value })}
          />
          <Input
            aria-label="Manufacturer"
            placeholder="Manufacturer"
            value={material.manufacturer}
            onChange={(e) => setMaterial({ ...material, manufacturer: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={pending}>
            <PlusIcon /> Add material
          </Button>
        </form>

        <form
          className="grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createQcLot(lot),
              "Lot added",
              () => setLot({ materialId: lot.materialId, lotNumber: "", expiresOn: "" }),
            );
          }}
        >
          <p className="text-table font-medium sm:col-span-4">New lot</p>
          <NativeSelect placeholder="Material…" aria-label="Material" value={lot.materialId} onChange={(e) => setLot({ ...lot, materialId: e.target.value })}>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.level}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label="Lot number" placeholder="Lot number" value={lot.lotNumber} onChange={(e) => setLot({ ...lot, lotNumber: e.target.value })} />
          <Input aria-label="Expiry date" type="date" value={lot.expiresOn} onChange={(e) => setLot({ ...lot, expiresOn: e.target.value })} />
          <Button type="submit" size="sm" disabled={pending || !lot.materialId}>
            <PlusIcon /> Add lot
          </Button>
        </form>

        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => setQcTarget({ ...target, mean: num(target.mean), sd: num(target.sd) }),
              "Target set",
              () => setTarget({ ...target, mean: "", sd: "", source: "" }),
            );
          }}
        >
          <p className="text-table font-medium sm:col-span-3">Target mean and SD</p>
          <NativeSelect placeholder="Lot…" aria-label="Lot" value={target.qcLotId} onChange={(e) => setTarget({ ...target, qcLotId: e.target.value })}>
            {activeLots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect placeholder="Test…" aria-label="Test" value={target.testId} onChange={(e) => setTarget({ ...target, testId: e.target.value })}>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            placeholder="Instrument…"
            aria-label="Instrument"
            value={target.instrumentId}
            onChange={(e) => setTarget({ ...target, instrumentId: e.target.value })}
          >
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label="Mean"
            placeholder="Mean"
            inputMode="decimal"
            value={target.mean}
            onChange={(e) => setTarget({ ...target, mean: e.target.value })}
          />
          <Input aria-label="SD" placeholder="SD" inputMode="decimal" value={target.sd} onChange={(e) => setTarget({ ...target, sd: e.target.value })} />
          <Input
            aria-label="Source"
            placeholder="Source, e.g. own data, 20 runs"
            value={target.source}
            onChange={(e) => setTarget({ ...target, source: e.target.value })}
          />
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending || !target.qcLotId || !target.testId || !target.instrumentId}>
            Set target
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
