"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BanIcon, CheckIcon, CircleXIcon, FileTextIcon, PlugZapIcon, TruckIcon, ZapIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Checkbox, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import { SendOutBadge } from "@/components/send-out-badge";
import type { LabSendOut, LabSendOutDispatchSummary, ReferenceLabSubmissionStatus } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import { byReferenceLaboratory, formatDuration } from "@/lib/lab-mapping";
import { cancelSendOut, dispatchSendOuts, recordSendOutRejected, recordSendOutResultsReceived, submitDispatchElectronically } from "../actions";

interface Permissions {
  /** lab.specimen.receive: dispatch, record results back, cancel. */
  handle: boolean;
  /** lab.specimen.reject: record a rejection by the reference laboratory. */
  reject: boolean;
}

/**
 * Send-outs at the selected facility. The API enforces permissions, the send-out lifecycle and the facility; buttons
 * only reflect what the user may attempt. Result values are entered on the workbench once results are back.
 */
export function SendOutsView({
  view,
  rows,
  dispatches,
  integration,
  permissions,
}: {
  view: "to_dispatch" | "awaiting" | "closed";
  rows: LabSendOut[];
  dispatches: LabSendOutDispatchSummary[];
  integration: ReferenceLabSubmissionStatus["integration"];
  permissions: Permissions;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <div className="flex flex-col gap-6">
      {view === "to_dispatch" ? (
        rows.length === 0 ? (
          <Empty text="Nothing waiting to be dispatched. Received specimens of referred tests appear here." />
        ) : (
          byReferenceLaboratory(rows).map((group) => (
            <DispatchPanel key={group.referenceLaboratoryId} name={group.name} rows={group.rows} permissions={permissions} onChanged={refresh} />
          ))
        )
      ) : view === "awaiting" ? (
        rows.length === 0 ? (
          <Empty text="No specimens are out at a reference laboratory." />
        ) : (
          <AwaitingTable rows={rows} permissions={permissions} onChanged={refresh} />
        )
      ) : rows.length === 0 ? (
        <Empty text="No closed send-outs yet." />
      ) : (
        <ClosedTable rows={rows} />
      )}
      <Dispatches dispatches={dispatches} integration={integration} canSubmit={permissions.handle} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border bg-card p-4 text-body text-muted-foreground">{text}</p>;
}

function useRun(onChanged: () => void) {
  const [pending, start] = React.useTransition();
  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        onChanged();
      } else toast.error(result.message ?? "Something went wrong.");
    });
  return { pending, run };
}

function PatientCell({ row }: { row: LabSendOut }) {
  return (
    <>
      <span className="font-medium">{row.patient?.displayName ?? "Patient"}</span>
      <span className="block text-meta text-muted-foreground">
        {row.patient ? `${row.patient.patientNumber} · ${row.patient.sex} · ${row.patient.age} y` : null}
      </span>
    </>
  );
}

function TestCell({ row }: { row: LabSendOut }) {
  return (
    <>
      {row.priority === "stat" ? (
        <Badge variant="critical" className="mr-1">
          <ZapIcon aria-hidden /> STAT
        </Badge>
      ) : null}
      {row.testName}
      <span className="block text-meta text-muted-foreground">
        {row.specimenTypeName} · order <span className="font-mono">{row.orderNumber}</span>
      </span>
    </>
  );
}

function DispatchPanel({ name, rows, permissions, onChanged }: { name: string; rows: LabSendOut[]; permissions: Permissions; onChanged: () => void }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(rows.map((r) => r.id)));
  const [courier, setCourier] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [pending, start] = React.useTransition();
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const idempotencyKey = React.useRef(crypto.randomUUID());

  const dispatch = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await dispatchSendOuts({ sendOutIds: [...selected], courier, courierReference: reference }, idempotencyKey.current);
      if (!result.ok) return void toast.error(result.message);
      idempotencyKey.current = crypto.randomUUID();
      toast.success(`Dispatched on manifest ${result.data.manifestNumber}. Print it to travel with the specimens.`, {
        duration: 15_000,
        action: { label: "Print manifest", onClick: () => window.open(fileHref.sendOutManifest(result.data.id), "_blank", "noopener") },
      });
      onChanged();
    });
  };

  return (
    <section aria-label={`To dispatch to ${name}`} className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <h2 className="text-section font-semibold">{name}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Include</span>
            </TableHead>
            <TableHead>Accession</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Test</TableHead>
            <TableHead>Collected</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <React.Fragment key={row.id}>
              <TableRow>
                <TableCell>
                  <Checkbox
                    aria-label={`Include ${row.accessionNumber} ${row.testCode}`}
                    checked={selected.has(row.id)}
                    disabled={!permissions.handle}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })
                    }
                  />
                </TableCell>
                <TableCell className="font-mono">{row.accessionNumber}</TableCell>
                <TableCell>
                  <PatientCell row={row} />
                </TableCell>
                <TableCell className="text-table">
                  <TestCell row={row} />
                </TableCell>
                <TableCell className="tabular text-table">{clinicalDateTime(row.collectedAt)}</TableCell>
                <TableCell className="text-right">
                  {permissions.handle ? (
                    <Button size="xs" variant="ghost" onClick={() => setCancelling(cancelling === row.id ? null : row.id)}>
                      <BanIcon /> Cancel…
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
              {cancelling === row.id ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <ReasonForm
                      label="Why is this send-out cancelled? (e.g. tested in-house)"
                      submitLabel="Cancel send-out"
                      destructive
                      onSubmit={(reason, run) => run(() => cancelSendOut({ sendOutId: row.id, reason }), `${row.testName}: send-out cancelled`)}
                      onDone={() => setCancelling(null)}
                      onChanged={onChanged}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
      {permissions.handle ? (
        <form onSubmit={dispatch} className="flex flex-wrap items-end gap-2 border-t pt-2">
          <div className="grid gap-1">
            <Label htmlFor={`courier-${name}`}>Courier *</Label>
            <Input id={`courier-${name}`} value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier company or rider" maxLength={120} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`reference-${name}`}>Courier manifest / waybill</Label>
            <Input id={`reference-${name}`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
          </div>
          <Button type="submit" size="sm" disabled={pending || selected.size === 0 || courier.trim().length === 0}>
            <TruckIcon /> Record dispatch of {selected.size}
          </Button>
          <p className="basis-full text-meta text-muted-foreground">
            Records the handover now and assigns the manifest number; print the manifest to travel with the specimens.
          </p>
        </form>
      ) : null}
    </section>
  );
}

function AwaitingTable({ rows, permissions, onChanged }: { rows: LabSendOut[]; permissions: Permissions; onChanged: () => void }) {
  const [open, setOpen] = React.useState<{ id: string; mode: "back" | "reject" | "cancel" } | null>(null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Accession</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Test</TableHead>
          <TableHead>Reference laboratory</TableHead>
          <TableHead>Dispatched</TableHead>
          <TableHead>Turnaround</TableHead>
          <TableHead className="w-56" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <React.Fragment key={row.id}>
            <TableRow>
              <TableCell className="font-mono">{row.accessionNumber}</TableCell>
              <TableCell>
                <PatientCell row={row} />
              </TableCell>
              <TableCell className="text-table">
                <TestCell row={row} />
              </TableCell>
              <TableCell className="text-table">
                {row.referenceLaboratoryName}
                {row.manifestNumber && row.dispatchId ? (
                  <a
                    href={fileHref.sendOutManifest(row.dispatchId)}
                    target="_blank"
                    rel="noreferrer"
                    className="block font-mono text-meta text-primary hover:underline"
                  >
                    {row.manifestNumber}
                  </a>
                ) : null}
              </TableCell>
              <TableCell className="tabular text-table">{row.dispatchedAt ? clinicalDateTime(row.dispatchedAt) : "—"}</TableCell>
              <TableCell className="text-table">
                <SendOutBadge status={row.status} overdue={row.overdue} />
                <span className="block text-meta text-muted-foreground">
                  {row.minutesOut !== null ? `Out ${formatDuration(row.minutesOut)}` : null}
                  {row.dueAt ? ` · expected by ${clinicalDateTime(row.dueAt)}` : " · no expected turnaround"}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {permissions.handle ? (
                    <Button size="xs" onClick={() => setOpen({ id: row.id, mode: "back" })}>
                      <CheckIcon /> Results back…
                    </Button>
                  ) : null}
                  {permissions.reject ? (
                    <Button size="xs" variant="outline" onClick={() => setOpen({ id: row.id, mode: "reject" })}>
                      <CircleXIcon /> Rejected…
                    </Button>
                  ) : null}
                  {permissions.handle ? (
                    <Button size="xs" variant="ghost" onClick={() => setOpen({ id: row.id, mode: "cancel" })}>
                      <BanIcon /> Cancel…
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
            {open?.id === row.id ? (
              <TableRow>
                <TableCell colSpan={7}>
                  {open.mode === "back" ? (
                    <ResultsBackForm row={row} onDone={() => setOpen(null)} onChanged={onChanged} />
                  ) : open.mode === "reject" ? (
                    <ReasonForm
                      label={`Why did ${row.referenceLaboratoryName} reject the specimen? (as it reported)`}
                      submitLabel="Record rejection"
                      destructive
                      withAccession
                      onSubmit={(reason, run, accession) =>
                        run(
                          () => recordSendOutRejected({ sendOutId: row.id, reason, referenceAccession: accession }),
                          `${row.testName}: rejection recorded — send again, recollect or test in-house`,
                        )
                      }
                      onDone={() => setOpen(null)}
                      onChanged={onChanged}
                    />
                  ) : (
                    <ReasonForm
                      label="Why is this send-out cancelled? (tell the reference laboratory too)"
                      submitLabel="Cancel send-out"
                      destructive
                      onSubmit={(reason, run) => run(() => cancelSendOut({ sendOutId: row.id, reason }), `${row.testName}: send-out cancelled`)}
                      onDone={() => setOpen(null)}
                      onChanged={onChanged}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : null}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function ResultsBackForm({ row, onDone, onChanged }: { row: LabSendOut; onDone: () => void; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  const [accession, setAccession] = React.useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => recordSendOutResultsReceived({ sendOutId: row.id, referenceAccession: accession }),
          `${row.testName}: results back — enter them on the workbench (they are attributed to ${row.referenceLaboratoryName})`,
          onDone,
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`accession-${row.id}`}>{row.referenceLaboratoryName}&apos;s accession number *</Label>
        <Input id={`accession-${row.id}`} autoFocus className="font-mono" value={accession} onChange={(e) => setAccession(e.target.value)} maxLength={60} />
      </div>
      <Button type="submit" size="sm" disabled={pending || accession.trim().length === 0}>
        Record results back
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Back
      </Button>
      <p className="basis-full text-meta text-muted-foreground">
        The values are then entered on the workbench as this test&apos;s result and verified, approved and released as usual.
      </p>
    </form>
  );
}

function ReasonForm({
  label,
  submitLabel,
  destructive,
  withAccession,
  onSubmit,
  onDone,
  onChanged,
}: {
  label: string;
  submitLabel: string;
  destructive?: boolean;
  withAccession?: boolean;
  onSubmit: (reason: string, run: ReturnType<typeof useRun>["run"], accession?: string) => void;
  onDone: () => void;
  onChanged: () => void;
}) {
  const { pending, run } = useRun(onChanged);
  const [reason, setReason] = React.useState("");
  const [accession, setAccession] = React.useState("");
  const id = React.useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason, (call, success) => run(call, success, onDone), accession || undefined);
      }}
    >
      <div className="grid min-w-72 flex-1 gap-1">
        <Label htmlFor={`${id}-reason`}>{label} *</Label>
        <Input id={`${id}-reason`} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
      {withAccession ? (
        <div className="grid gap-1">
          <Label htmlFor={`${id}-accession`}>Their accession number</Label>
          <Input id={`${id}-accession`} className="font-mono" value={accession} onChange={(e) => setAccession(e.target.value)} maxLength={60} />
        </div>
      ) : null}
      <Button type="submit" size="sm" variant={destructive ? "destructive" : "default"} disabled={pending || reason.trim().length < 3}>
        {submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Back
      </Button>
    </form>
  );
}

function ClosedTable({ rows }: { rows: LabSendOut[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Accession</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Test</TableHead>
          <TableHead>Reference laboratory</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono">{row.accessionNumber}</TableCell>
            <TableCell>
              <PatientCell row={row} />
            </TableCell>
            <TableCell className="text-table">
              <TestCell row={row} />
            </TableCell>
            <TableCell className="text-table">
              {row.referenceLaboratoryName}
              {row.referenceAccession ? (
                <span className="block font-mono text-meta text-muted-foreground">Their accession {row.referenceAccession}</span>
              ) : null}
            </TableCell>
            <TableCell className="text-table">
              <SendOutBadge status={row.status} />
              <span className="block text-meta text-muted-foreground">
                {row.status === "results_received" && row.resultsReceivedAt
                  ? `Back ${clinicalDateTime(row.resultsReceivedAt)}${row.minutesOut !== null ? ` after ${formatDuration(row.minutesOut)}` : ""}`
                  : (row.rejectionReason ?? row.cancellationReason ?? "")}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Dispatches({
  dispatches,
  integration,
  canSubmit,
}: {
  dispatches: LabSendOutDispatchSummary[];
  integration: ReferenceLabSubmissionStatus["integration"];
  canSubmit: boolean;
}) {
  const [pending, start] = React.useTransition();
  const submit = (dispatchId: string) =>
    start(async () => {
      const result = await submitDispatchElectronically(dispatchId, crypto.randomUUID());
      if (result.ok) toast.success("Queued for the reference laboratory's interface.");
      else toast.error(result.message);
    });
  return (
    <section aria-labelledby="dispatches-heading" className="flex flex-col gap-2">
      <h2 id="dispatches-heading" className="text-section font-semibold">
        Recent dispatches
      </h2>
      <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
        <PlugZapIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Electronic interface:{" "}
        {integration.status === "dependency" ? "not configured (integration dependency). " : `${integration.name} (${integration.status}). `}
        {integration.note}
      </p>
      {dispatches.length === 0 ? (
        <p className="text-meta text-muted-foreground">No dispatches yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Manifest</TableHead>
              <TableHead>Reference laboratory</TableHead>
              <TableHead>Courier</TableHead>
              <TableHead>Dispatched</TableHead>
              <TableHead className="text-right">Tests</TableHead>
              <TableHead className="w-48" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {dispatches.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <a
                    href={fileHref.sendOutManifest(d.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                  >
                    <FileTextIcon className="size-3.5" aria-hidden /> {d.manifestNumber}
                  </a>
                </TableCell>
                <TableCell className="text-table">{d.referenceLaboratoryName}</TableCell>
                <TableCell className="text-table">
                  {d.courier}
                  {d.courierReference ? <span className="block text-meta text-muted-foreground">{d.courierReference}</span> : null}
                </TableCell>
                <TableCell className="tabular text-table">
                  {clinicalDateTime(d.dispatchedAt)}
                  {d.dispatchedByName ? <span className="block text-meta text-muted-foreground">by {d.dispatchedByName}</span> : null}
                </TableCell>
                <TableCell className="tabular text-right">{d.sendOuts}</TableCell>
                <TableCell className="text-right">
                  {d.electronicReference ? (
                    <Badge variant="success">
                      <CheckIcon aria-hidden /> Acknowledged {d.electronicReference}
                    </Badge>
                  ) : canSubmit ? (
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => submit(d.id)}>
                      <PlugZapIcon /> Send electronically
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
