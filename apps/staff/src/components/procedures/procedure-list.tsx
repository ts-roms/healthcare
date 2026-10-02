"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, FileCheck2Icon, ShieldAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { markProcedureInError, recordProcedureConsent } from "@/app/(staff)/clinic/procedure-actions";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { ClinicProcedure, ProcedureDefinition } from "@/lib/api/types";
import { BLANK_PROCEDURE_FORM, type ProcedureForm } from "@/lib/procedure-form";
import { CAPTURED_VIA_LABEL, ConsentFields, consentPrintHref } from "./consent-fields";

/**
 * Procedures as recorded (in a consultation or under a queue visit): what, when, by whom, the consent recorded against
 * each, supplies used (when the caller passes them), entered in error with a reason. Consent missing on an earlier
 * record can be added once.
 */
export function ProcedureList({
  procedures,
  patientId,
  definitions,
  documents,
  canMark,
  canAddConsent,
  supplies,
  showFiledUnder = false,
}: {
  procedures: ClinicProcedure[];
  patientId: string;
  /** For the consent print link and wording of each procedure's catalogue entry; empty when not loaded. */
  definitions: ProcedureDefinition[];
  documents: ConsentFormDocument[] | null;
  /** Whether this user may mark the procedure entered in error. */
  canMark: (p: ClinicProcedure) => boolean;
  /** encounter.write or procedure.record: may add the consent to a procedure recorded without one. */
  canAddConsent: boolean;
  /** Supplies used, rendered under a procedure (the encounter workspace). */
  supplies?: (p: ClinicProcedure) => React.ReactNode;
  /** Say where it was recorded (the patient record lists both kinds). */
  showFiledUnder?: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {procedures.map((p) => (
        <ProcedureRow
          key={p.id}
          procedure={p}
          patientId={patientId}
          definition={definitions.find((d) => d.id === p.definitionId)}
          documents={documents}
          canMark={canMark(p)}
          canAddConsent={canAddConsent}
          supplies={supplies?.(p)}
          showFiledUnder={showFiledUnder}
        />
      ))}
    </ul>
  );
}

function ProcedureRow({
  procedure: p,
  patientId,
  definition,
  documents,
  canMark,
  canAddConsent,
  supplies,
  showFiledUnder,
}: {
  procedure: ClinicProcedure;
  patientId: string;
  definition: ProcedureDefinition | undefined;
  documents: ConsentFormDocument[] | null;
  canMark: boolean;
  canAddConsent: boolean;
  supplies: React.ReactNode;
  showFiledUnder: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<"error" | "consent" | null>(null);
  const [reason, setReason] = React.useState("");
  const [consent, setConsent] = React.useState<ProcedureForm>({ ...BLANK_PROCEDURE_FORM, consentGiven: true, consentRequired: true });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const ids = { procedureId: p.id, encounterId: p.encounterId, visitId: p.visitId, patientId };
  const set = <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => setConsent((f) => ({ ...f, [key]: value }));
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
        {p.consent ? (
          <Badge variant="outline">
            <FileCheck2Icon aria-hidden /> Consent recorded
          </Badge>
        ) : definition?.consentRequired && !p.enteredInError ? (
          <Badge variant="warning">
            <AlertTriangleIcon aria-hidden /> Consent not recorded
          </Badge>
        ) : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {clinicalDateTime(p.performedAt)} · performed by {p.performer.name}
        {p.recordedByName ? ` · recorded by ${p.recordedByName}` : ""}
        {showFiledUnder ? (
          p.encounterId ? (
            <>
              {" · "}
              <Link href={`/clinic/encounters/${p.encounterId}`} className="text-primary hover:underline">
                in a consultation
              </Link>
            </>
          ) : (
            " · outside a consultation"
          )
        ) : null}
      </p>
      {p.notes ? <p className="text-meta whitespace-pre-line">Note: {p.notes}</p> : null}
      {p.lateEntryReason ? <p className="text-meta">Why recorded after signing: {p.lateEntryReason}</p> : null}
      {p.consent ? (
        <p className="text-meta">
          Consent {CAPTURED_VIA_LABEL[p.consent.capturedVia].toLowerCase()} by{" "}
          {p.consent.givenBy === "patient"
            ? "the patient"
            : `${p.consent.representativeName}${p.consent.representativeRelationship ? ` (${p.consent.representativeRelationship})` : ""}`}
          , obtained by {p.consent.obtainedBy.name} {clinicalDateTime(p.consent.obtainedAt)}
          {p.consent.wording ? ` · wording version ${p.consent.wording.version}` : ""}
          {p.consent.documentId ? " · signed form linked" : ""}
          {p.consent.notes ? ` · ${p.consent.notes}` : ""}
        </p>
      ) : null}
      {p.enteredInError ? (
        <p className="text-meta">
          Entered in error: {p.enteredInError.reason}
          {p.enteredInError.byName ? ` (${p.enteredInError.byName}, ${clinicalDateTime(p.enteredInError.at)})` : ""}
        </p>
      ) : null}
      {supplies}
      {!open && !p.enteredInError && (canMark || (canAddConsent && !p.consent)) ? (
        <div className="flex flex-wrap gap-1">
          {canAddConsent && !p.consent ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => setOpen("consent")}>
              Record consent…
            </Button>
          ) : null}
          {canMark ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => setOpen("error")}>
              Entered in error…
            </Button>
          ) : null}
        </div>
      ) : null}
      {open === "consent" ? (
        <form
          noValidate
          aria-label="Record consent"
          className="grid gap-2 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await recordProcedureConsent(ids, {
                ...consent,
                consentWordingId: consent.consentWordingId || (definition?.consentWording?.id ?? ""),
              });
              if (result.ok) {
                toast.success("Consent recorded");
                setOpen(null);
                router.refresh();
              } else setError(result.message);
            });
          }}
        >
          <ConsentFields
            id={`consent-${p.id}`}
            form={consent}
            set={set}
            wording={definition?.consentWording ?? null}
            printHref={consentPrintHref(definition, patientId)}
            documents={documents}
            required
            showToggle={false}
          />
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="xs" disabled={pending}>
              Record consent
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {open === "error" ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await markProcedureInError({ ...ids, reason });
              if (result.ok) {
                toast.success("Procedure marked entered in error", { description: "A charge not yet invoiced is cancelled." });
                setOpen(null);
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
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(null)}>
            Cancel
          </Button>
        </form>
      ) : null}
    </li>
  );
}
