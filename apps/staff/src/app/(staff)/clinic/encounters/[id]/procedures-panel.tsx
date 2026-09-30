"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, HandIcon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, DateTimeInput, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { issueProcedureSupplies, markProcedureInError, recordProcedure, returnProcedureSupplies } from "@/app/(staff)/clinic/procedure-actions";
import { SuppliesUsed } from "@/components/supplies-used";
import type { ClinicProcedure, Practitioner, ProcedureDefinition, ProcedureSupplyOptions, SupplyUse } from "@/lib/api/types";
import { draftFromTemplate } from "@/lib/supply-mapping";
import { BLANK_PROCEDURE_FORM, definitionLabel, type ProcedureForm } from "@/lib/procedure-form";

export interface EncounterProcedures {
  items: ClinicProcedure[];
  definitions: ProcedureDefinition[];
  practitioners: Practitioner[];
  /** encounter.write (after signing, the API also needs encounter.amend). */
  canRecord: boolean;
  canAmend: boolean;
  currentUserId: string;
  /** Supplies used by these procedures (from inventory), and what the supplies form needs (encounter.write). */
  supplyUses: SupplyUse[];
  supplyOptions: ProcedureSupplyOptions | null;
}

/**
 * Procedures performed in this consultation (docs/domains/clinic.md, "Procedures"): recorded from the organization's
 * own catalogue with who performed them; a mistake is marked entered in error with a reason (never edited or deleted).
 * Not for online consultations. Billing charges a procedure its catalogue maps to a service. The supplies a procedure
 * used are issued from inventory under it (and unused ones returned), like dental procedures.
 */
export function ProceduresPanel({
  encounterId,
  patientId,
  status,
  inPerson,
  data,
}: {
  encounterId: string;
  patientId: string;
  status: "in_progress" | "completed" | "entered_in_error";
  inPerson: boolean;
  data: EncounterProcedures | null;
}) {
  const [adding, setAdding] = React.useState(false);
  if (!data) return null;
  const signed = status === "completed";
  const mayAdd = data.canRecord && inPerson && status !== "entered_in_error" && (!signed || data.canAmend) && data.definitions.length > 0;
  return (
    <section className="flex flex-col gap-2" aria-label="Procedures">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          <HandIcon className="size-3.5" aria-hidden /> Procedures
        </h3>
        {mayAdd && !adding ? (
          <Button type="button" size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden /> Record procedure
          </Button>
        ) : null}
      </div>
      {data.items.length ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {data.items.map((p) => (
            <ProcedureRow
              key={p.id}
              procedure={p}
              encounterId={encounterId}
              patientId={patientId}
              canMark={data.canRecord && !p.enteredInError && (p.recordedBy === data.currentUserId || data.canAmend)}
              supplies={
                <SuppliesUsed
                  procedureId={p.id}
                  active={!p.enteredInError}
                  uses={data.supplyUses}
                  options={data.supplyOptions}
                  template={
                    data.supplyOptions
                      ? draftFromTemplate(
                          data.supplyOptions.items.map((i) => i.id),
                          data.supplyOptions.templates.find((t) => t.definitionId === p.definitionId)?.items,
                        )
                      : []
                  }
                  canRecord={data.canRecord && data.supplyOptions !== null}
                  onIssue={(input) => issueProcedureSupplies(encounterId, p.id, input)}
                  onReturn={(input) => returnProcedureSupplies(encounterId, p.id, input)}
                />
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-table text-muted-foreground">No procedure recorded in this consultation.</p>
      )}
      {!inPerson ? <p className="text-meta text-muted-foreground">Procedures are recorded in in-person consultations.</p> : null}
      {inPerson && data.canRecord && !data.definitions.length ? (
        <p className="text-meta text-muted-foreground">No procedures in the catalogue yet: an administrator adds them under Clinic → Procedures.</p>
      ) : null}
      {adding ? (
        <RecordProcedureForm
          encounterId={encounterId}
          patientId={patientId}
          signed={signed}
          definitions={data.definitions}
          practitioners={data.practitioners}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

function ProcedureRow({
  procedure: p,
  encounterId,
  patientId,
  canMark,
  supplies,
}: {
  procedure: ClinicProcedure;
  encounterId: string;
  patientId: string;
  canMark: boolean;
  supplies: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={p.enteredInError ? "text-body line-through" : "text-body font-medium"}>{p.description}</span>
        <span className="font-mono text-meta text-muted-foreground">{p.code}</span>
        {p.enteredInError ? (
          <Badge variant="neutral">
            <ShieldAlertIcon aria-hidden /> Entered in error
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2Icon aria-hidden /> Done
          </Badge>
        )}
        {p.lateEntryReason ? (
          <Badge variant="warning">
            <AlertTriangleIcon aria-hidden /> Recorded after signing
          </Badge>
        ) : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {clinicalDateTime(p.performedAt)} · performed by {p.performer.name}
        {p.recordedByName ? ` · recorded by ${p.recordedByName}` : ""}
      </p>
      {p.notes ? <p className="text-meta whitespace-pre-line">Note: {p.notes}</p> : null}
      {p.lateEntryReason ? <p className="text-meta">Why recorded after signing: {p.lateEntryReason}</p> : null}
      {p.enteredInError ? (
        <p className="text-meta">
          Entered in error: {p.enteredInError.reason}
          {p.enteredInError.byName ? ` (${p.enteredInError.byName}, ${clinicalDateTime(p.enteredInError.at)})` : ""}
        </p>
      ) : null}
      {supplies}
      {canMark && !open ? (
        <div>
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
            Entered in error…
          </Button>
        </div>
      ) : null}
      {open ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await markProcedureInError({ procedureId: p.id, encounterId, patientId, reason });
              if (result.ok) {
                toast.success("Procedure marked entered in error", { description: "A charge not yet invoiced is cancelled." });
                setOpen(false);
                router.refresh();
              } else toast.error(result.message);
            });
          }}
        >
          <Label htmlFor={`proc-error-${p.id}`} className="sr-only">
            Reason
          </Label>
          <Input
            id={`proc-error-${p.id}`}
            className="h-7 w-80"
            placeholder="Reason (e.g. recorded on the wrong consultation)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
            Confirm
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function RecordProcedureForm({
  encounterId,
  patientId,
  signed,
  definitions,
  practitioners,
  onDone,
}: {
  encounterId: string;
  patientId: string;
  signed: boolean;
  definitions: ProcedureDefinition[];
  practitioners: Practitioner[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<ProcedureForm>({ ...BLANK_PROCEDURE_FORM, signed });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const chosen = definitions.find((d) => d.id === form.definitionId);
  const id = `procedure-${encounterId}`;
  return (
    <form
      noValidate
      aria-label="Record a procedure"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await recordProcedure(encounterId, patientId, { ...form, requiresBodySite: chosen?.requiresBodySite ?? false, signed });
          if (result.ok) {
            toast.success(`${result.data.name} recorded`);
            router.refresh();
            onDone();
          } else setError(result.message);
        });
      }}
    >
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor={`${id}-definition`}>Procedure *</Label>
        <NativeSelect
          id={`${id}-definition`}
          placeholder="Choose…"
          emptyText="No procedures in the catalogue"
          value={form.definitionId}
          onChange={(e) => set("definitionId", e.target.value)}
        >
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {definitionLabel(d)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor={`${id}-performer`}>Performed by</Label>
        <NativeSelect
          id={`${id}-performer`}
          value={form.performerPractitionerId}
          emptyText="No other practitioners set up"
          onChange={(e) => set("performerPractitionerId", e.target.value)}
        >
          <option value="">Me</option>
          {practitioners
            .filter((p) => p.status === "active")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-when`}>When</Label>
        <DateTimeInput id={`${id}-when`} value={form.performedAt} onValueChange={(v) => set("performedAt", v)} />
        <span className="text-meta text-muted-foreground">Leave empty for now.</span>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-site`}>{chosen?.requiresBodySite ? "Body site *" : "Body site"}</Label>
        <Input id={`${id}-site`} maxLength={120} placeholder="e.g. left forearm" value={form.bodySite} onChange={(e) => set("bodySite", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-quantity`}>How many</Label>
        <Input id={`${id}-quantity`} inputMode="numeric" maxLength={2} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
        <span className="text-meta text-muted-foreground">Billed as this quantity.</span>
      </div>
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      {signed ? (
        <div className="grid gap-1 sm:col-span-6">
          <Label htmlFor={`${id}-late`}>Why is it recorded after signing? *</Label>
          <Input
            id={`${id}-late`}
            maxLength={500}
            placeholder="e.g. not recorded before signing"
            value={form.lateEntryReason}
            onChange={(e) => set("lateEntryReason", e.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          Record procedure
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
