"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertOctagonIcon,
  BanIcon,
  CheckIcon,
  FileIcon,
  FlaskConicalIcon,
  PaperclipIcon,
  PencilIcon,
  PrinterIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  TruckIcon,
  ZapIcon,
} from "lucide-react";
import { clinicalDateTime, LabFlagBadge } from "@healthcare/ui/healthcare";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { PerformedBy, SendOutBadge } from "@/components/send-out-badge";
import type { LabOrderItem, LabResult, LabWorklistRow, LabWorklistStage, ReferenceLaboratory } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import {
  bySpecimenType,
  ITEM_STATUS_LABEL,
  parseResultInput,
  PRIORITY_LABEL,
  referenceText,
  RESULT_STATUS_LABEL,
  resultValue,
  uiFlag,
} from "@/lib/lab-mapping";
import {
  attachResultFile,
  cancelResult,
  collectSpecimen,
  correctResult,
  enterResult,
  prepareSendOut,
  receiveSpecimen,
  rejectSpecimen,
  removeResultAttachment,
  resultAttachmentUrl,
  signResult,
} from "../actions";
import { fileSize } from "@/lib/lab-attachments";

export interface LabPermissions {
  collect: boolean;
  receive: boolean;
  reject: boolean;
  enter: boolean;
  verify: boolean;
  approve: boolean;
  release: boolean;
  amend: boolean;
}

/**
 * One specimen (or, to collect, one order) with every action that applies
 * to it now. The API enforces permissions, separation of duties and the
 * result lifecycle; buttons only reflect what the user may attempt.
 */
export function WorkbenchDetail({
  row,
  stage,
  permissions,
  specimenTypeName,
  referenceLabs,
  onChanged,
}: {
  row: LabWorklistRow;
  /** Null for a scanned specimen (no stage context). */
  stage: LabWorklistStage | null;
  permissions: LabPermissions;
  specimenTypeName: Map<string, string>;
  referenceLabs: ReferenceLaboratory[];
  onChanged: () => void;
}) {
  const { order, patient, specimen, items } = row;
  // Tests with a reference laboratory are entered once its results are back (see /laboratory/send-outs).
  const inFlight = (i: LabOrderItem) => i.sendOut?.status === "prepared" || i.sendOut?.status === "dispatched";
  const toEnter = items.filter((i) => i.status === "received" && !i.result && !inFlight(i));
  const sentOut = items.filter((i) => i.sendOut && i.status !== "cancelled");
  const withResults = items.filter((i) => i.result);
  const canReject = permissions.reject && specimen && ["collected", "received"].includes(specimen.status) && !items.some((i) => i.status === "released");

  return (
    <div className="flex flex-col gap-4 p-3">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-section font-semibold">{patient?.displayName ?? "Patient"}</h2>
          {order.priority === "stat" ? (
            <Badge variant="critical">
              <ZapIcon aria-hidden /> STAT
            </Badge>
          ) : (
            <Badge variant="neutral">{PRIORITY_LABEL[order.priority]}</Badge>
          )}
          {order.fastingRequired ? <Badge variant="info">Fasting</Badge> : null}
        </div>
        <p className="text-meta text-muted-foreground">
          {patient ? `${patient.patientNumber} · ${patient.sex} · ${patient.age} y · ` : null}
          Order <span className="font-mono">{order.orderNumber}</span> · {clinicalDateTime(order.orderedAt)}
        </p>
        <p className="text-meta text-muted-foreground">
          Requested by {order.orderingPractitionerName ?? order.externalOrderer ?? order.orderedByName ?? "—"}
          {order.source === "external" ? " (external)" : order.source === "patient_request" ? " (patient request)" : ""}
        </p>
        {order.clinicalIndication ? <p className="text-table">Indication: {order.clinicalIndication}</p> : null}
        {order.notes ? <p className="text-table text-muted-foreground">Notes: {order.notes}</p> : null}
        {specimen ? (
          <p className="mt-1 rounded-md border bg-card px-2 py-1.5 text-table">
            <FlaskConicalIcon className="mr-1 inline size-4 align-text-bottom" aria-hidden />
            <span className="font-mono text-body font-semibold">{specimen.accessionNumber}</span> ·{" "}
            {specimenTypeName.get(specimen.specimenTypeId) ?? "Specimen"} · {specimen.status} · collected {clinicalDateTime(specimen.collectedAt)}
            {specimen.collectedByName ? ` by ${specimen.collectedByName}` : ""}
            {specimen.receivedAt ? ` · received ${clinicalDateTime(specimen.receivedAt)}` : ""}
          </p>
        ) : null}
        {specimen && permissions.collect && specimen.status !== "rejected" ? (
          <Button asChild size="xs" variant="outline" className="self-start">
            <a href={fileHref.specimenLabel(specimen.id)} target="_blank" rel="noreferrer">
              <PrinterIcon /> Print tube label
            </a>
          </Button>
        ) : null}
      </header>

      {stage === "collect" && permissions.collect ? <CollectPanel row={row} specimenTypeName={specimenTypeName} onChanged={onChanged} /> : null}

      {specimen?.status === "collected" && permissions.receive ? <ReceiveButton specimenId={specimen.id} onChanged={onChanged} /> : null}

      {sentOut.length ? <SendOutList items={sentOut} /> : null}

      {toEnter.length && permissions.enter ? <EnterPanel items={toEnter} onChanged={onChanged} /> : null}

      {toEnter.length && permissions.receive && referenceLabs.length ? (
        <SendOutForm items={toEnter} referenceLabs={referenceLabs} onChanged={onChanged} />
      ) : null}

      {withResults.length ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-2">
          <h3 id="results-heading" className="text-table font-semibold">
            Results
          </h3>
          {withResults.map((item) => (
            <ResultRow key={item.id} item={item} result={item.result!} permissions={permissions} onChanged={onChanged} />
          ))}
          <SignAll items={withResults} permissions={permissions} onChanged={onChanged} />
        </section>
      ) : null}

      {items.some((i) => i.status === "cancelled") ? (
        <p className="text-meta text-muted-foreground">
          Cancelled:{" "}
          {items
            .filter((i) => i.status === "cancelled")
            .map((i) => `${i.testName} (${i.cancellationReason})`)
            .join("; ")}
        </p>
      ) : null}

      {canReject && specimen ? <RejectForm specimenId={specimen.id} onChanged={onChanged} /> : null}
    </div>
  );
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

function CollectPanel({ row, specimenTypeName, onChanged }: { row: LabWorklistRow; specimenTypeName: Map<string, string>; onChanged: () => void }) {
  const [pending, start] = React.useTransition();
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const groups = [...bySpecimenType(row.items).entries()];

  const collect = (specimenTypeId: string, items: LabOrderItem[]) =>
    start(async () => {
      const itemIds = items.filter((i) => !excluded.has(i.id)).map((i) => i.id);
      const result = await collectSpecimen({ orderId: row.order.id, specimenTypeId, itemIds }, crypto.randomUUID());
      if (!result.ok) return void toast.error(result.message);
      const specimen = result.data.specimens.at(-1);
      toast.success(`Collected. Label the tube: ${specimen?.accessionNumber}`, {
        duration: 15_000,
        action: specimen ? { label: "Print label", onClick: () => window.open(fileHref.specimenLabel(specimen.id), "_blank", "noopener") } : undefined,
      });
      onChanged();
    });

  return (
    <section aria-labelledby="collect-heading" className="flex flex-col gap-2">
      <h3 id="collect-heading" className="text-table font-semibold">
        Collect
      </h3>
      {groups.map(([specimenTypeId, items]) => (
        <div key={specimenTypeId} className="flex flex-col gap-1.5 rounded-md border bg-card p-2">
          <p className="text-table font-medium">{specimenTypeName.get(specimenTypeId) ?? "Specimen"}</p>
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-table">
              <Checkbox
                checked={!excluded.has(item.id)}
                onCheckedChange={(checked) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (checked) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              />
              {item.testName}
            </label>
          ))}
          <Button size="sm" className="self-start" disabled={pending || items.every((i) => excluded.has(i.id))} onClick={() => collect(specimenTypeId, items)}>
            <FlaskConicalIcon /> Collect {specimenTypeName.get(specimenTypeId)?.toLowerCase() ?? "specimen"}
          </Button>
        </div>
      ))}
    </section>
  );
}

function ReceiveButton({ specimenId, onChanged }: { specimenId: string; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  return (
    <Button size="sm" className="self-start" disabled={pending} onClick={() => run(() => receiveSpecimen(specimenId), "Specimen received")}>
      <CheckIcon /> Receive specimen
    </Button>
  );
}

function RejectForm({ specimenId, onChanged }: { specimenId: string; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [recollect, setRecollect] = React.useState(true);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="self-start text-danger-foreground" onClick={() => setOpen(true)}>
        <BanIcon /> Reject specimen…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-danger/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => rejectSpecimen({ specimenId, reason, requestRecollection: recollect }),
          recollect ? "Specimen rejected; recollection requested" : "Specimen rejected",
        );
      }}
    >
      <Label htmlFor="reject-reason">Why is the specimen rejected? *</Label>
      <Input
        id="reject-reason"
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Haemolysed, clotted, unlabelled"
        maxLength={500}
      />
      <label className="flex items-center gap-2 text-table">
        <Checkbox checked={recollect} onCheckedChange={(c) => setRecollect(c === true)} /> Request recollection (otherwise the tests are cancelled)
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
          Reject
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep
        </Button>
      </div>
    </form>
  );
}

function ValueInput({ item, id, value, onChange }: { item: LabOrderItem; id: string; value: string; onChange: (v: string) => void }) {
  if (item.resultType === "coded") {
    return (
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {item.codedValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (item.resultType === "text") return <Textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} maxLength={4000} />;
  return (
    <div className="flex items-center gap-1.5">
      <Input id={id} inputMode="decimal" className="w-28 font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
      {item.unit ? <span className="text-meta text-muted-foreground">{item.unit}</span> : null}
    </div>
  );
}

function EnterPanel({ items, onChanged }: { items: LabOrderItem[]; onChanged: () => void }) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [comments, setComments] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const filled = items.filter((i) => (values[i.id] ?? "").trim());

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const nextErrors: Record<string, string> = {};
      let saved = 0;
      for (const item of filled) {
        const parsed = parseResultInput(item.resultType, values[item.id] ?? "");
        if (!parsed.ok) {
          nextErrors[item.id] = parsed.message;
          continue;
        }
        const result = await enterResult({ itemId: item.id, value: parsed.value, comment: comments[item.id] });
        if (result.ok) saved += 1;
        else nextErrors[item.id] = result.message;
      }
      setErrors(nextErrors);
      if (saved) {
        toast.success(`${saved} result${saved === 1 ? "" : "s"} entered — waiting for verification`);
        onChanged();
      }
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2" aria-labelledby="enter-heading">
      <h3 id="enter-heading" className="text-table font-semibold">
        Enter results
      </h3>
      {items.map((item) => (
        <div key={item.id} className="grid gap-1 rounded-md border bg-card p-2">
          <Label htmlFor={`value-${item.id}`}>{item.testName}</Label>
          {item.sendOut?.status === "results_received" ? (
            <p className="text-meta text-muted-foreground">
              From {item.sendOut.referenceLaboratoryName}&apos;s report
              {item.sendOut.referenceAccession ? ` (their accession ${item.sendOut.referenceAccession})` : ""} — recorded as performed by them
            </p>
          ) : null}
          <ValueInput item={item} id={`value-${item.id}`} value={values[item.id] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [item.id]: v }))} />
          <Input
            aria-label={`Comment for ${item.testName}`}
            placeholder="Comment (optional)"
            value={comments[item.id] ?? ""}
            onChange={(e) => setComments((s) => ({ ...s, [item.id]: e.target.value }))}
            maxLength={2000}
          />
          {errors[item.id] ? (
            <p role="alert" className="text-meta text-danger-foreground">
              {errors[item.id]}
            </p>
          ) : null}
        </div>
      ))}
      <p className="text-meta text-muted-foreground">Flags are computed against the laboratory&apos;s reference range for the patient&apos;s sex and age.</p>
      <Button type="submit" size="sm" className="self-start" disabled={pending || filled.length === 0}>
        <SendIcon /> Save {filled.length || ""} result{filled.length === 1 ? "" : "s"}
      </Button>
    </form>
  );
}

const NEXT_STEP: Partial<Record<LabResult["status"], { step: "verify" | "approve" | "release"; label: string; permission: keyof LabPermissions }>> = {
  entered: { step: "verify", label: "Verify", permission: "verify" },
  verified: { step: "approve", label: "Approve", permission: "approve" },
  approved: { step: "release", label: "Release", permission: "release" },
};

function ResultRow({ item, result, permissions, onChanged }: { item: LabOrderItem; result: LabResult; permissions: LabPermissions; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  const [mode, setMode] = React.useState<"view" | "correct" | "cancel">("view");
  const flag = uiFlag(result.flag);
  const next = NEXT_STEP[result.status];
  const canCorrect = result.status === "released" ? permissions.amend : permissions.enter;
  const reference = referenceText(result);

  return (
    <div className={`flex flex-col gap-1 rounded-md border p-2 ${result.critical ? "border-critical/60 bg-critical/5" : "bg-card"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.testName}</span>
        <span className="font-mono text-body font-semibold">{resultValue(result)}</span>
        {result.unit ? <span className="text-meta text-muted-foreground">{result.unit}</span> : null}
        {flag ? <LabFlagBadge flag={flag} /> : null}
        {result.critical ? (
          <Badge variant="critical">
            <AlertOctagonIcon aria-hidden /> Critical
          </Badge>
        ) : null}
        <Badge variant={result.status === "released" ? "success" : "info"} className="ml-auto">
          {RESULT_STATUS_LABEL[result.status]}
        </Badge>
      </div>
      <p className="text-meta text-muted-foreground">
        {reference ? `Reference ${reference}${result.unit ? ` ${result.unit}` : ""} · ` : "No reference range · "}
        Entered by {result.enteredByName ?? "—"}
        {result.verifiedByName ? ` · verified by ${result.verifiedByName}${result.selfVerified ? " (self, by facility policy)" : ""}` : ""}
        {result.approvedByName ? ` · approved by ${result.approvedByName}${result.selfApproved ? " (self, by facility policy)" : ""}` : ""}
        {result.releasedByName ? ` · released by ${result.releasedByName}` : ""}
      </p>
      {result.versionNumber > 1 ? (
        <p className="text-meta text-warning-foreground">
          <TriangleAlertIcon className="mr-1 inline size-3.5" aria-hidden />
          Version {result.versionNumber}: {result.correctionReason}
        </p>
      ) : null}
      {result.comment ? <p className="text-meta">Comment: {result.comment}</p> : null}
      <PerformedBy laboratory={result.performingLaboratory} />
      <ResultAttachments result={result} editable={result.status === "entered" && permissions.enter} onChanged={onChanged} />

      {mode === "view" ? (
        <div className="flex flex-wrap gap-1.5">
          {next && permissions[next.permission] ? (
            <Button
              size="xs"
              disabled={pending}
              onClick={() => run(() => signResult({ resultId: result.id, step: next.step }), `${item.testName}: ${next.label.toLowerCase()}d`)}
            >
              {next.step === "release" ? <SendIcon /> : <ShieldCheckIcon />} {next.label}
            </Button>
          ) : null}
          {canCorrect ? (
            <Button size="xs" variant="outline" disabled={pending} onClick={() => setMode("correct")}>
              <PencilIcon /> Correct…
            </Button>
          ) : null}
          {result.status !== "released" && permissions.enter ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setMode("cancel")}>
              <BanIcon /> Cancel result…
            </Button>
          ) : null}
          <span className="self-center text-meta text-muted-foreground">{ITEM_STATUS_LABEL[item.status]}</span>
        </div>
      ) : (
        <ChangeForm item={item} result={result} mode={mode} onDone={() => setMode("view")} onChanged={onChanged} />
      )}
    </div>
  );
}

function ChangeForm({
  item,
  result,
  mode,
  onDone,
  onChanged,
}: {
  item: LabOrderItem;
  result: LabResult;
  mode: "correct" | "cancel";
  onDone: () => void;
  onChanged: () => void;
}) {
  const { pending, run } = useRun(onChanged);
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "cancel") return run(() => cancelResult({ resultId: result.id, reason }), `${item.testName}: result cancelled`, onDone);
    const parsed = parseResultInput(item.resultType, value);
    if (!parsed.ok) return setError(parsed.message);
    run(
      () => correctResult({ resultId: result.id, value: parsed.value, reason }),
      `${item.testName}: corrected version entered — it needs verification and approval again`,
      onDone,
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-2">
      {mode === "correct" ? (
        <>
          <Label htmlFor={`correct-${result.id}`}>Corrected value</Label>
          <ValueInput item={item} id={`correct-${result.id}`} value={value} onChange={setValue} />
          {result.status === "released" ? (
            <p className="text-meta text-warning-foreground">
              This result was released. The corrected version replaces it after sign-off; the original stays in the history and the ordering practitioner is
              told.
            </p>
          ) : null}
        </>
      ) : null}
      <Label htmlFor={`reason-${result.id}`}>{mode === "correct" ? "Reason for the correction *" : "Reason for cancelling *"}</Label>
      <Input id={`reason-${result.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="xs" variant={mode === "cancel" ? "destructive" : "default"} disabled={pending || reason.trim().length < 3}>
          {mode === "correct" ? "Save correction" : "Cancel result"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onDone}>
          Back
        </Button>
      </div>
    </form>
  );
}

/** One click for the common case: sign off every result on this specimen that is at the same step. */
function SignAll({ items, permissions, onChanged }: { items: LabOrderItem[]; permissions: LabPermissions; onChanged: () => void }) {
  const [pending, start] = React.useTransition();
  const groups = (["verify", "approve", "release"] as const)
    .map((step) => {
      const status = step === "verify" ? "entered" : step === "approve" ? "verified" : "approved";
      return { step, results: items.map((i) => i.result!).filter((r) => r.status === status) };
    })
    .filter((g) => g.results.length > 1 && permissions[g.step]);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map(({ step, results }) => (
        <Button
          key={step}
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              let done = 0;
              for (const r of results) {
                const outcome = await signResult({ resultId: r.id, step });
                if (outcome.ok) done += 1;
                else toast.error(outcome.message);
              }
              if (done)
                toast.success(`${done} result${done === 1 ? "" : "s"}: ${step === "verify" ? "verified" : step === "approve" ? "approved" : "released"}`);
              onChanged();
            })
          }
        >
          {step === "verify" ? "Verify" : step === "approve" ? "Approve" : "Release"} all {results.length}
        </Button>
      ))}
    </div>
  );
}

/**
 * Files on a result version. Added or removed only while the result is entered (from verification on they are part of
 * what was verified and released); opening one fetches a short-lived link, audited by the API.
 */
function ResultAttachments({ result, editable, onChanged }: { result: LabResult; editable: boolean; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [opening, startOpen] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const attachments = result.attachments ?? [];
  if (!editable && attachments.length === 0) return null;

  const open = (attachmentId: string) =>
    startOpen(async () => {
      const link = await resultAttachmentUrl(attachmentId);
      if (link.ok) window.open(link.data.url, "_blank", "noopener,noreferrer");
      else toast.error(link.message);
    });
  const upload = (file: File | undefined) => {
    if (!file) return;
    const data = new FormData();
    data.set("resultId", result.id);
    data.set("file", file);
    run(
      () => attachResultFile(data),
      `Attached ${file.name}`,
      () => {
        if (fileRef.current) fileRef.current.value = "";
      },
    );
  };

  return (
    <div className="flex flex-col gap-1" aria-label="Attachments">
      {attachments.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 text-meta">
          <FileIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium">{a.title}</span>
          <span className="text-muted-foreground">
            {a.fileName} · {fileSize(a.sizeBytes)}
          </span>
          {a.status === "pending" ? (
            <Badge variant="warning">Upload not finished</Badge>
          ) : (
            <Button size="xs" variant="ghost" disabled={opening} onClick={() => open(a.id)}>
              Open
            </Button>
          )}
          {editable && removing !== a.id ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => (setRemoving(a.id), setReason(""))}>
              Remove…
            </Button>
          ) : null}
          {editable && removing === a.id ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => removeResultAttachment({ attachmentId: a.id, reason }),
                  `Removed ${a.title}`,
                  () => setRemoving(null),
                );
              }}
            >
              <Input
                aria-label="Reason for removing"
                placeholder="Reason (kept with the result)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-7 w-56"
              />
              <Button size="xs" type="submit" variant="destructive" disabled={pending || reason.trim().length < 5}>
                Remove
              </Button>
              <Button size="xs" type="button" variant="ghost" onClick={() => setRemoving(null)}>
                Keep
              </Button>
            </form>
          ) : null}
        </div>
      ))}
      {editable ? (
        <label className="inline-flex w-fit cursor-pointer items-center gap-1 text-meta text-primary hover:underline">
          <PaperclipIcon className="size-3.5" aria-hidden />
          {pending ? "Attaching…" : "Attach a file (PDF or image, up to 10 MB)"}
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept="application/pdf,image/jpeg,image/png,image/heic,image/tiff"
            disabled={pending}
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      ) : null}
    </div>
  );
}

/** Tests of this specimen referred to a reference laboratory, with where each stands. */
function SendOutList({ items }: { items: LabOrderItem[] }) {
  return (
    <section aria-labelledby="send-outs-heading" className="flex flex-col gap-1.5">
      <h3 id="send-outs-heading" className="text-table font-semibold">
        Referred to a reference laboratory
      </h3>
      {items.map((item) => {
        const sendOut = item.sendOut;
        if (!sendOut) return null;
        return (
          <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-table">
            <span className="font-medium">{item.testName}</span>
            <span className="text-muted-foreground">{sendOut.referenceLaboratoryName}</span>
            <SendOutBadge status={sendOut.status} className="ml-auto" />
            {sendOut.rejectionReason ? <span className="basis-full text-meta text-muted-foreground">Their reason: {sendOut.rejectionReason}</span> : null}
          </div>
        );
      })}
      <Link href="/laboratory/send-outs" className="self-start text-meta text-primary hover:underline">
        Dispatch and record results back on the send-outs page
      </Link>
    </section>
  );
}

/** Refer received tests by hand (tests configured as referred are prepared when the specimen is received). */
function SendOutForm({ items, referenceLabs, onChanged }: { items: LabOrderItem[]; referenceLabs: ReferenceLaboratory[]; onChanged: () => void }) {
  const { pending, run } = useRun(onChanged);
  const [open, setOpen] = React.useState(false);
  const [labId, setLabId] = React.useState(referenceLabs[0]?.id ?? "");
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <TruckIcon /> Send to a reference laboratory…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => prepareSendOut({ orderItemIds: [...chosen], referenceLaboratoryId: labId }),
          "Prepared for dispatch",
          () => setOpen(false),
        );
      }}
    >
      <Label htmlFor="send-out-lab">Reference laboratory</Label>
      <NativeSelect id="send-out-lab" value={labId} onChange={(e) => setLabId(e.target.value)}>
        {referenceLabs.map((lab) => (
          <option key={lab.id} value={lab.id}>
            {lab.name}
          </option>
        ))}
      </NativeSelect>
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-2 text-table">
          <Checkbox
            checked={chosen.has(item.id)}
            onCheckedChange={(checked) =>
              setChosen((prev) => {
                const next = new Set(prev);
                if (checked) next.add(item.id);
                else next.delete(item.id);
                return next;
              })
            }
          />
          {item.testName}
        </label>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || chosen.size === 0 || !labId}>
          Prepare send-out
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}
