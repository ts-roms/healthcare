"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  FileInputIcon,
  HistoryIcon,
  InfoIcon,
  ListChecksIcon,
  LockIcon,
  PillIcon,
  PlusIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import {
  markHistoryInError,
  recordFamilyHistory,
  recordPastCondition,
  recordPastProcedure,
  recordReportedMedication,
  recordSocialHistory,
  reviewFamilyHistory,
  stopReportedMedication,
} from "@/app/(staff)/patients/history-actions";
import type {
  FamilyHistoryEntry,
  FamilyHistoryState,
  FamilyReview,
  PastCondition,
  PastProcedure,
  PatientHistory,
  ReportedMedication,
  SocialHistoryVersion,
} from "@/lib/api/types";
import {
  alcoholText,
  BLANK_CONDITION,
  BLANK_FAMILY,
  BLANK_MEDICATION,
  BLANK_PROCEDURE,
  CONDITION_STATUS_LABEL,
  type ConditionForm,
  type FamilyForm,
  familyStateView,
  INFORMANT_LABEL,
  MEDICATION_STATUS_LABEL,
  type MedicationForm,
  medicationPeriodLabel,
  partialDateLabel,
  type ProcedureForm,
  RELATIONSHIP_LABEL,
  socialFormFrom,
  type SocialForm,
  socialPayload,
  sourceLabel,
  tobaccoText,
  UNKNOWN_REASON_LABEL,
  USE_STATUS_LABEL,
} from "@/lib/history-form";
import { filedUnderLookup, filedUnderText } from "@/lib/patient-merge";

type Linked = ReadonlyArray<{ id: string; patientNumber: string }> | undefined;

/** The family history state: colour + icon + text. */
export function FamilyStateBadge({ state, latestReview }: { state: FamilyHistoryState; latestReview: Pick<FamilyReview, "unknownReason"> | null }) {
  const view = familyStateView(state, latestReview);
  const Icon =
    view.tone === "missing" ? AlertTriangleIcon : view.tone === "none" ? CheckCircle2Icon : view.tone === "unknown" ? CircleHelpIcon : ListChecksIcon;
  return (
    <Badge variant={view.variant}>
      <Icon aria-hidden /> {view.label}
    </Badge>
  );
}

function SourceBadge({ source, reportedBy }: { source: string; reportedBy?: PastProcedure["reportedBy"] }) {
  return (
    <Badge variant="outline">
      {source === "external_import" ? <FileInputIcon aria-hidden /> : null}
      {sourceLabel({ source, reportedBy })}
    </Badge>
  );
}

function InErrorBadge() {
  return (
    <Badge variant="neutral">
      <ShieldAlertIcon aria-hidden /> Entered in error
    </Badge>
  );
}

function Recorded({ entry, filedUnder }: { entry: Pick<PastProcedure, "recordedAt" | "recordedByName" | "enteredInError">; filedUnder: string | null }) {
  return (
    <>
      <p className="text-meta text-muted-foreground">
        {[`recorded ${clinicalDateTime(entry.recordedAt)}${entry.recordedByName ? ` by ${entry.recordedByName}` : ""}`, filedUnder].filter(Boolean).join(" · ")}
      </p>
      {entry.enteredInError ? (
        <p className="text-meta">
          Entered in error: {entry.enteredInError.reason}
          {entry.enteredInError.byName ? ` (${entry.enteredInError.byName}, ${clinicalDateTime(entry.enteredInError.at)})` : ""}
        </p>
      ) : null}
    </>
  );
}

/** "Entered in error…" with a reason: nothing is edited or deleted. */
function InErrorAction({ patientId, entryId, encounterId, what }: { patientId: string; entryId: string; encounterId?: string; what: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open)
    return (
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Entered in error…
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await markHistoryInError({ patientId, entryId, encounterId, reason });
          if (result.ok) {
            toast.success(`${what} marked entered in error`);
            setOpen(false);
            setReason("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <Input
        aria-label="Reason"
        className="h-7 w-80"
        placeholder="Reason (e.g. recorded on the wrong patient)"
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
  );
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  ) : null;
}

function Field({ id, label, span = 3, children, hint }: { id: string; label: string; span?: 2 | 3 | 6; children: React.ReactNode; hint?: string }) {
  const cls = span === 6 ? "sm:col-span-6" : span === 2 ? "sm:col-span-2" : "sm:col-span-3";
  return (
    <div className={`grid gap-1 ${cls}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <span className="text-meta text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Provenance<
  T extends { source: "reported" | "recorded_here"; reportedBy: "" | "patient" | "relative" | "other_provider"; sourceDescription?: string },
>({ idPrefix, form, set }: { idPrefix: string; form: T; set: <K extends keyof T>(key: K, value: T[K]) => void }) {
  return (
    <>
      <Field id={`${idPrefix}-source`} label="Source" span={2}>
        <NativeSelect id={`${idPrefix}-source`} value={form.source} onChange={(e) => set("source", e.target.value as T["source"])}>
          <option value="reported">Reported to us</option>
          <option value="recorded_here">Documented here (e.g. from records brought)</option>
        </NativeSelect>
      </Field>
      {form.source === "reported" ? (
        <Field id={`${idPrefix}-by`} label="Reported by *" span={2}>
          <NativeSelect id={`${idPrefix}-by`} value={form.reportedBy} onChange={(e) => set("reportedBy", e.target.value as T["reportedBy"])}>
            {Object.entries(INFORMANT_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field id={`${idPrefix}-source-description`} label="Where the information comes from" span={form.source === "reported" ? 2 : 3}>
        <Input
          id={`${idPrefix}-source-description`}
          maxLength={300}
          placeholder="e.g. Discharge summary, 2019"
          value={form.sourceDescription ?? ""}
          onChange={(e) => set("sourceDescription", e.target.value as T["sourceDescription"])}
        />
      </Field>
    </>
  );
}

function CodeFields<T extends { codeSystem: string; code: string }>({
  idPrefix,
  form,
  set,
}: {
  idPrefix: string;
  form: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
}) {
  return (
    <>
      <Field
        id={`${idPrefix}-code-system`}
        label="Code system (optional)"
        span={3}
        hint="Your organization's key, e.g. icd-10; no national code set is assumed."
      >
        <Input id={`${idPrefix}-code-system`} maxLength={40} value={form.codeSystem} onChange={(e) => set("codeSystem", e.target.value as T["codeSystem"])} />
      </Field>
      <Field id={`${idPrefix}-code`} label="Code" span={3}>
        <Input id={`${idPrefix}-code`} maxLength={60} value={form.code} onChange={(e) => set("code", e.target.value as T["code"])} />
      </Field>
    </>
  );
}

function useFormState<T>(blank: T) {
  const [form, setForm] = React.useState<T>(blank);
  const set = <K extends keyof T>(key: K, value: T[K]) => setForm((f) => ({ ...f, [key]: value }));
  return { form, setForm, set };
}

function Actions({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex gap-2 sm:col-span-6">
      <Button type="submit" size="sm" disabled={pending}>
        {label}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function useSubmit(onSaved: () => void) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const submit = (work: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        router.refresh();
        onSaved();
      } else setError(result.message);
    });
  };
  return { error, pending, submit };
}

export function ProcedureFormView({ patientId, encounterId, onDone }: { patientId: string; encounterId?: string; onDone: () => void }) {
  const { form, setForm, set } = useFormState<ProcedureForm>({ ...BLANK_PROCEDURE, encounterId });
  const { error, pending, submit } = useSubmit(() => {
    setForm({ ...BLANK_PROCEDURE, encounterId });
    onDone();
  });
  const id = `procedure-${encounterId ?? "record"}`;
  return (
    <form
      noValidate
      aria-label="Record a past procedure"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => recordPastProcedure(patientId, form), "Past procedure recorded");
      }}
    >
      <Field id={`${id}-description`} label="Procedure or surgery *" span={6}>
        <Input
          id={`${id}-description`}
          maxLength={300}
          placeholder="e.g. Appendectomy"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Field id={`${id}-performed`} label="When" span={2} hint="A year or month is fine when that is all that is known.">
        <Input id={`${id}-performed`} placeholder="2019, 2019-05 or 2019-05-12" value={form.performed} onChange={(e) => set("performed", e.target.value)} />
      </Field>
      <Field id={`${id}-performer`} label="Where / by whom" span={2}>
        <Input id={`${id}-performer`} maxLength={300} value={form.performer} onChange={(e) => set("performer", e.target.value)} />
      </Field>
      <Field id={`${id}-site`} label="Side or body site" span={2}>
        <Input id={`${id}-site`} maxLength={120} placeholder="e.g. left knee" value={form.bodySite} onChange={(e) => set("bodySite", e.target.value)} />
      </Field>
      <CodeFields idPrefix={id} form={form} set={set} />
      <Provenance idPrefix={id} form={form} set={set} />
      <Field id={`${id}-notes`} label="Notes (staff only)" span={6}>
        <Textarea id={`${id}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <FormError error={error} />
      <Actions pending={pending} label="Record past procedure" onCancel={onDone} />
    </form>
  );
}

export function ConditionFormView({ patientId, encounterId, onDone }: { patientId: string; encounterId?: string; onDone: () => void }) {
  const { form, setForm, set } = useFormState<ConditionForm>({ ...BLANK_CONDITION, encounterId });
  const { error, pending, submit } = useSubmit(() => {
    setForm({ ...BLANK_CONDITION, encounterId });
    onDone();
  });
  const id = `condition-${encounterId ?? "record"}`;
  return (
    <form
      noValidate
      aria-label="Record a past condition"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => recordPastCondition(patientId, form), "Past condition recorded");
      }}
    >
      <p className="flex items-start gap-2 text-meta text-muted-foreground sm:col-span-6">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />A condition diagnosed elsewhere, as reported. To diagnose it yourself, record a diagnosis
        in the consultation.
      </p>
      <Field id={`${id}-description`} label="Condition *" span={6}>
        <Input
          id={`${id}-description`}
          maxLength={300}
          placeholder="e.g. Pulmonary tuberculosis, treated"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Field id={`${id}-onset`} label="Since" span={2}>
        <Input id={`${id}-onset`} placeholder="2019, 2019-05 or 2019-05-12" value={form.onset} onChange={(e) => set("onset", e.target.value)} />
      </Field>
      <Field id={`${id}-status`} label="Status as reported *" span={2}>
        <NativeSelect id={`${id}-status`} value={form.status} onChange={(e) => set("status", e.target.value as ConditionForm["status"])}>
          {Object.entries(CONDITION_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-diagnosed-by`} label="Diagnosed or treated at" span={2}>
        <Input id={`${id}-diagnosed-by`} maxLength={300} value={form.diagnosedBy} onChange={(e) => set("diagnosedBy", e.target.value)} />
      </Field>
      <CodeFields idPrefix={id} form={form} set={set} />
      <Provenance idPrefix={id} form={form} set={set} />
      <Field id={`${id}-notes`} label="Notes (staff only)" span={6}>
        <Textarea id={`${id}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <FormError error={error} />
      <Actions pending={pending} label="Record past condition" onCancel={onDone} />
    </form>
  );
}

export function MedicationFormView({ patientId, encounterId, onDone }: { patientId: string; encounterId?: string; onDone: () => void }) {
  const { form, setForm, set } = useFormState<MedicationForm>({ ...BLANK_MEDICATION, encounterId });
  const { error, pending, submit } = useSubmit(() => {
    setForm({ ...BLANK_MEDICATION, encounterId });
    onDone();
  });
  const id = `medication-${encounterId ?? "record"}`;
  return (
    <form
      noValidate
      aria-label="Record a medicine taken"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => recordReportedMedication(patientId, form), "Medicine taken recorded");
      }}
    >
      <p className="flex items-start gap-2 text-meta text-muted-foreground sm:col-span-6">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />A medicine prescribed elsewhere, bought over the counter, or a supplement or herbal remedy,
        as reported. It is not a prescription and is not checked against allergies. To prescribe, use the consultation.
      </p>
      <Field id={`${id}-medication`} label="Medicine *" span={3}>
        <Input
          id={`${id}-medication`}
          maxLength={200}
          placeholder="e.g. Losartan 50 mg tablet"
          value={form.medication}
          onChange={(e) => set("medication", e.target.value)}
        />
      </Field>
      <Field id={`${id}-dose`} label="How taken" span={3}>
        <Input id={`${id}-dose`} maxLength={200} placeholder="e.g. 1 tablet every morning" value={form.dose} onChange={(e) => set("dose", e.target.value)} />
      </Field>
      <Field id={`${id}-reason`} label="What for" span={3}>
        <Input id={`${id}-reason`} maxLength={300} placeholder="e.g. high blood pressure" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
      </Field>
      <Field id={`${id}-prescribed-by`} label="Prescribed by / from where" span={3}>
        <Input
          id={`${id}-prescribed-by`}
          maxLength={300}
          placeholder="e.g. Cardiologist at another hospital; over the counter"
          value={form.prescribedBy}
          onChange={(e) => set("prescribedBy", e.target.value)}
        />
      </Field>
      <Field id={`${id}-status`} label="Still taking? *" span={2}>
        <NativeSelect id={`${id}-status`} value={form.status} onChange={(e) => set("status", e.target.value as MedicationForm["status"])}>
          {Object.entries(MEDICATION_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-started`} label="Since" span={2} hint="A year or month is fine.">
        <Input id={`${id}-started`} placeholder="2019, 2019-05 or 2019-05-12" value={form.started} onChange={(e) => set("started", e.target.value)} />
      </Field>
      {form.status === "stopped" ? (
        <Field id={`${id}-stopped`} label="Stopped" span={2}>
          <Input id={`${id}-stopped`} placeholder="2020, 2020-03 or 2020-03-01" value={form.stopped} onChange={(e) => set("stopped", e.target.value)} />
        </Field>
      ) : null}
      <CodeFields idPrefix={id} form={form} set={set} />
      <Provenance idPrefix={id} form={form} set={set} />
      <Field id={`${id}-notes`} label="Notes (staff only)" span={6}>
        <Textarea id={`${id}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <FormError error={error} />
      <Actions pending={pending} label="Record medicine taken" onCancel={onDone} />
    </form>
  );
}

/** "Mark stopped…": when, as precise as known, and an optional note; once, never undone. */
function StopMedicationAction({ patientId, entryId, encounterId }: { patientId: string; entryId: string; encounterId?: string }) {
  const [open, setOpen] = React.useState(false);
  const [stopped, setStopped] = React.useState("");
  const [note, setNote] = React.useState("");
  const { error, pending, submit } = useSubmit(() => {
    setOpen(false);
    setStopped("");
    setNote("");
  });
  if (!open)
    return (
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Mark stopped…
      </Button>
    );
  const id = `stop-${entryId}`;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => stopReportedMedication(patientId, entryId, { stopped, note }, encounterId), "Medicine marked stopped");
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${id}-date`} className="sr-only">
          When stopped
        </Label>
        <Input id={`${id}-date`} className="h-7 w-44" placeholder="When (2025, 2025-03…)" value={stopped} onChange={(e) => setStopped(e.target.value)} />
        <Label htmlFor={`${id}-note`} className="sr-only">
          Note
        </Label>
        <Input
          id={`${id}-note`}
          className="h-7 w-72"
          maxLength={500}
          placeholder="Note (optional, e.g. stopped by own doctor)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" size="xs" disabled={pending}>
          Confirm stopped
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function FamilyFormView({ patientId, encounterId, onDone }: { patientId: string; encounterId?: string; onDone: () => void }) {
  const { form, setForm, set } = useFormState<FamilyForm>({ ...BLANK_FAMILY, encounterId });
  const { error, pending, submit } = useSubmit(() => {
    setForm({ ...BLANK_FAMILY, encounterId });
    onDone();
  });
  const id = `family-${encounterId ?? "record"}`;
  return (
    <form
      noValidate
      aria-label="Record family history"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => recordFamilyHistory(patientId, form), "Family history recorded");
      }}
    >
      <Field id={`${id}-relationship`} label="Relative *" span={2}>
        <NativeSelect
          placeholder="Choose…"
          id={`${id}-relationship`}
          value={form.relationship}
          onChange={(e) => set("relationship", e.target.value as FamilyForm["relationship"])}
        >
          {Object.entries(RELATIONSHIP_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-relationship-text`} label={form.relationship === "other" ? "Who *" : "Detail"} span={2}>
        <Input
          id={`${id}-relationship-text`}
          maxLength={100}
          placeholder={form.relationship === "other" ? "e.g. Godmother" : "e.g. older"}
          value={form.relationshipText}
          onChange={(e) => set("relationshipText", e.target.value)}
        />
      </Field>
      <Field id={`${id}-by`} label="Reported by" span={2}>
        <NativeSelect id={`${id}-by`} value={form.reportedBy} onChange={(e) => set("reportedBy", e.target.value as FamilyForm["reportedBy"])}>
          {Object.entries(INFORMANT_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-condition`} label="Condition *" span={3}>
        <Input id={`${id}-condition`} maxLength={300} value={form.condition} onChange={(e) => set("condition", e.target.value)} />
      </Field>
      <Field id={`${id}-age`} label="Age at onset" span={3}>
        <Input id={`${id}-age`} inputMode="numeric" maxLength={3} value={form.onsetAge} onChange={(e) => set("onsetAge", e.target.value)} />
      </Field>
      <Field id={`${id}-deceased`} label="Has the relative died?" span={3}>
        <NativeSelect id={`${id}-deceased`} value={form.deceased} onChange={(e) => set("deceased", e.target.value as FamilyForm["deceased"])}>
          <option value="">Not stated</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </NativeSelect>
      </Field>
      {form.deceased === "yes" ? (
        <Field id={`${id}-cause`} label="Cause of death (as reported)" span={3}>
          <Input id={`${id}-cause`} maxLength={300} value={form.causeOfDeath} onChange={(e) => set("causeOfDeath", e.target.value)} />
        </Field>
      ) : null}
      <CodeFields idPrefix={id} form={form} set={set} />
      <Field id={`${id}-notes`} label="Notes (staff only)" span={6}>
        <Textarea id={`${id}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <FormError error={error} />
      <Actions pending={pending} label="Record family history" onCancel={onDone} />
    </form>
  );
}

/** Records the family history review: complete as listed, none known, or not known (with the reason). */
export function FamilyReviewButtons({ patientId, encounterId, hasEntries }: { patientId: string; encounterId?: string; hasEntries: boolean }) {
  const [unknown, setUnknown] = React.useState(false);
  const [reason, setReason] = React.useState<"" | "adopted" | "not_known" | "declined_to_answer">("");
  const { error, pending, submit } = useSubmit(() => setUnknown(false));
  const review = (outcome: "reviewed" | "none_known" | "unknown") =>
    submit(
      () => reviewFamilyHistory(patientId, { outcome, unknownReason: outcome === "unknown" ? reason : "", notes: "", encounterId }),
      outcome === "reviewed"
        ? "Family history reviewed"
        : outcome === "none_known"
          ? "Recorded: no known family history"
          : "Recorded: family history not known",
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {hasEntries ? (
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => review("reviewed")}>
            <ListChecksIcon /> Reviewed: complete as listed
          </Button>
        ) : (
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => review("none_known")}>
            <CheckCircle2Icon /> No known family history
          </Button>
        )}
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setUnknown((v) => !v)}>
          <CircleHelpIcon /> Not known…
        </Button>
      </div>
      {unknown ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor={`unknown-${encounterId ?? "record"}`} className="sr-only">
            Why not known
          </Label>
          <NativeSelect
            placeholder="Why not known…"
            id={`unknown-${encounterId ?? "record"}`}
            className="h-7 w-60"
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
          >
            {Object.entries(UNKNOWN_REASON_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" size="xs" disabled={pending || !reason} onClick={() => review("unknown")}>
            Record
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const SOCIAL_TEXT: Array<{ key: keyof SocialForm; label: string; sensitive?: boolean; max: number }> = [
  { key: "occupation", label: "Occupation", max: 200 },
  { key: "occupationalExposures", label: "Occupational exposures", max: 1000 },
  { key: "livingSituation", label: "Living situation / household", max: 1000 },
  { key: "physicalActivity", label: "Physical activity", max: 1000 },
  { key: "diet", label: "Diet", max: 1000 },
  { key: "substanceUse", label: "Other substance use", sensitive: true, max: 1000 },
  { key: "sexualHistory", label: "Sexual history", sensitive: true, max: 1000 },
  { key: "notes", label: "Notes", max: 2000 },
];

/** Records a new social history version, prefilled from the current one. */
export function SocialVersionForm({
  patientId,
  current,
  sensitiveAccess,
  encounterId,
  onDone,
}: {
  patientId: string;
  current: SocialHistoryVersion | null;
  sensitiveAccess: boolean;
  encounterId?: string;
  onDone: () => void;
}) {
  const { form, set } = useFormState<SocialForm>(socialFormFrom(current));
  const { error, pending, submit } = useSubmit(onDone);
  const id = `social-${encounterId ?? "record"}`;
  return (
    <form
      noValidate
      aria-label="Record social history"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = socialPayload(form, current, sensitiveAccess);
        if (!payload.ok) {
          toast.error(payload.message);
          return;
        }
        submit(() => recordSocialHistory(patientId, { ...payload.body, ...(encounterId ? { encounterId } : {}) }), "Social history recorded (new version)");
      }}
    >
      <Field id={`${id}-tobacco`} label="Tobacco" span={2}>
        <NativeSelect id={`${id}-tobacco`} value={form.tobaccoStatus} onChange={(e) => set("tobaccoStatus", e.target.value as SocialForm["tobaccoStatus"])}>
          <option value="">Not asked</option>
          {Object.entries(USE_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {form.tobaccoStatus === "former" || form.tobaccoStatus === "current" ? (
        <>
          <Field id={`${id}-tobacco-type`} label="Type" span={2}>
            <Input
              id={`${id}-tobacco-type`}
              maxLength={120}
              placeholder="e.g. Cigarettes, vape"
              value={form.tobaccoType}
              onChange={(e) => set("tobaccoType", e.target.value)}
            />
          </Field>
          <Field id={`${id}-tobacco-amount`} label="Amount per day" span={2}>
            <Input id={`${id}-tobacco-amount`} maxLength={120} value={form.tobaccoAmount} onChange={(e) => set("tobaccoAmount", e.target.value)} />
          </Field>
        </>
      ) : null}
      {form.tobaccoStatus === "former" ? (
        <Field id={`${id}-quit`} label="Year stopped" span={2}>
          <Input id={`${id}-quit`} inputMode="numeric" maxLength={4} value={form.tobaccoQuitYear} onChange={(e) => set("tobaccoQuitYear", e.target.value)} />
        </Field>
      ) : null}
      <Field id={`${id}-alcohol`} label="Alcohol" span={2}>
        <NativeSelect id={`${id}-alcohol`} value={form.alcoholStatus} onChange={(e) => set("alcoholStatus", e.target.value as SocialForm["alcoholStatus"])}>
          <option value="">Not asked</option>
          {Object.entries(USE_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {form.alcoholStatus === "former" || form.alcoholStatus === "current" ? (
        <Field id={`${id}-alcohol-frequency`} label="How often" span={2}>
          <Input id={`${id}-alcohol-frequency`} maxLength={200} value={form.alcoholFrequency} onChange={(e) => set("alcoholFrequency", e.target.value)} />
        </Field>
      ) : null}
      <Field id={`${id}-effective`} label="As of" span={2} hint="Leave empty for today.">
        <Input id={`${id}-effective`} type="date" value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} />
      </Field>
      {SOCIAL_TEXT.filter((f) => sensitiveAccess || !f.sensitive).map((f) => (
        <Field key={f.key} id={`${id}-${f.key}`} label={f.sensitive ? `${f.label} (sensitive)` : f.label} span={f.max > 200 ? 6 : 3}>
          <Textarea
            id={`${id}-${f.key}`}
            rows={1}
            maxLength={f.max}
            value={form[f.key]}
            onChange={(e) => set(f.key, e.target.value as SocialForm[typeof f.key])}
          />
        </Field>
      ))}
      {!sensitiveAccess ? (
        <p className="flex items-center gap-1.5 text-meta text-muted-foreground sm:col-span-6">
          <LockIcon className="size-3.5" aria-hidden /> Substance use and sexual history are recorded by the treating clinician; they are kept unchanged.
        </p>
      ) : null}
      <FormError error={error} />
      <Actions pending={pending} label={current ? "Record new version" : "Record social history"} onCancel={onDone} />
    </form>
  );
}

/** One social history version as a definition list; sensitive parts marked, or said to be withheld. */
export function SocialHistoryDetails({ version }: { version: SocialHistoryVersion }) {
  const rows: Array<[string, string | null, boolean?]> = [
    ["Tobacco", tobaccoText(version)],
    ["Alcohol", alcoholText(version)],
    ["Occupation", version.occupation],
    ["Occupational exposures", version.occupationalExposures],
    ["Living situation", version.livingSituation],
    ["Physical activity", version.physicalActivity],
    ["Diet", version.diet],
    ["Other substance use", version.substanceUse, true],
    ["Sexual history", version.sexualHistory, true],
    ["Notes", version.notes],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.length ? (
        <dl className="grid gap-x-4 gap-y-1 text-table sm:grid-cols-[max-content_1fr]">
          {shown.map(([label, value, sensitive]) => (
            <React.Fragment key={label}>
              <dt className="flex items-center gap-1 text-muted-foreground">
                {sensitive ? <LockIcon className="size-3.5" aria-hidden /> : null}
                {label}
                {sensitive ? <span className="sr-only">(sensitive)</span> : null}
              </dt>
              <dd className="whitespace-pre-line">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <p className="text-table text-muted-foreground">Nothing else recorded.</p>
      )}
      {version.sensitiveWithheld ? (
        <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <LockIcon className="size-3.5" aria-hidden /> Substance use and sexual history are not shown to you.
        </p>
      ) : null}
    </div>
  );
}

type Opened = "none" | "procedure" | "condition" | "medication" | "family" | "social";

/**
 * The patient's history in five sections (past procedures, past conditions, medications taken, family history, social history) with
 * recording for users who may (history.record). Entries in error stay listed, struck through; a social history change
 * is a new version (earlier versions listed below the current one).
 */
export function HistorySections({
  patientId,
  history,
  canRecord,
  encounterId,
  linkedRecords,
  compact = false,
}: {
  patientId: string;
  history: PatientHistory;
  canRecord: boolean;
  encounterId?: string;
  linkedRecords?: Linked;
  /** In the encounter workspace: entries in error and earlier versions left out. */
  compact?: boolean;
}) {
  const [opened, setOpened] = React.useState<Opened>("none");
  const close = () => setOpened("none");
  const filedUnder = filedUnderLookup(linkedRecords);
  const visible = <T extends { enteredInError: object | null }>(rows: T[]) => (compact ? rows.filter((r) => !r.enteredInError) : rows);
  const procedures = visible(history.procedures);
  const conditions = visible(history.conditions);
  const medications = visible(history.medications);
  const family = visible(history.family.entries);
  const current = history.social.current;
  const add = (what: Opened, label: string) =>
    canRecord && opened !== what ? (
      <Button type="button" size="xs" variant="outline" onClick={() => setOpened(what)}>
        <PlusIcon /> {label}
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Past procedures and surgeries" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-table font-semibold">Past procedures and surgeries</h3>
          {add("procedure", "Add procedure")}
        </div>
        {opened === "procedure" ? <ProcedureFormView patientId={patientId} encounterId={encounterId} onDone={close} /> : null}
        {procedures.length ? (
          <ul className="flex flex-col divide-y rounded-md border">
            {procedures.map((p) => (
              <ProcedureRow
                key={p.id}
                entry={p}
                patientId={patientId}
                canRecord={canRecord}
                encounterId={encounterId}
                filedUnder={filedUnderText(filedUnder(p.patientId))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">No past procedures recorded.</p>
        )}
      </section>

      <section aria-label="Past conditions" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-table font-semibold">Past conditions (diagnosed elsewhere)</h3>
          {add("condition", "Add condition")}
        </div>
        {opened === "condition" ? <ConditionFormView patientId={patientId} encounterId={encounterId} onDone={close} /> : null}
        {conditions.length ? (
          <ul className="flex flex-col divide-y rounded-md border">
            {conditions.map((c) => (
              <ConditionRow
                key={c.id}
                entry={c}
                patientId={patientId}
                canRecord={canRecord}
                encounterId={encounterId}
                filedUnder={filedUnderText(filedUnder(c.patientId))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">No past conditions recorded. Diagnoses made here are on the problem list.</p>
        )}
      </section>

      <section aria-label="Medications taken" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-table font-semibold">Medications taken (not prescribed here)</h3>
          {add("medication", "Add medicine")}
        </div>
        {opened === "medication" ? <MedicationFormView patientId={patientId} encounterId={encounterId} onDone={close} /> : null}
        {medications.length ? (
          <ul className="flex flex-col divide-y rounded-md border">
            {medications.map((m) => (
              <MedicationRow
                key={m.id}
                entry={m}
                patientId={patientId}
                canRecord={canRecord}
                encounterId={encounterId}
                filedUnder={filedUnderText(filedUnder(m.patientId))}
              />
            ))}
          </ul>
        ) : (
          <p className="text-table text-muted-foreground">
            No medications from elsewhere recorded. Prescriptions issued here are listed with the prescriptions.
          </p>
        )}
      </section>

      <section aria-label="Family history" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-table font-semibold">Family history</h3>
            <FamilyStateBadge state={history.family.state} latestReview={history.family.latestReview} />
          </div>
          {add("family", "Add relative's condition")}
        </div>
        {history.family.latestReview ? (
          <p className="text-meta text-muted-foreground">
            Last asked {clinicalDateTime(history.family.latestReview.reviewedAt)}
            {history.family.latestReview.reviewedByName ? ` by ${history.family.latestReview.reviewedByName}` : ""}
          </p>
        ) : null}
        {opened === "family" ? <FamilyFormView patientId={patientId} encounterId={encounterId} onDone={close} /> : null}
        {family.length ? (
          <ul className="flex flex-col divide-y rounded-md border">
            {family.map((f) => (
              <FamilyRow
                key={f.id}
                entry={f}
                patientId={patientId}
                canRecord={canRecord}
                encounterId={encounterId}
                filedUnder={filedUnderText(filedUnder(f.patientId))}
              />
            ))}
          </ul>
        ) : null}
        {canRecord ? (
          <FamilyReviewButtons patientId={patientId} encounterId={encounterId} hasEntries={history.family.entries.some((e) => !e.enteredInError)} />
        ) : null}
      </section>

      <section aria-label="Social history" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-table font-semibold">Social history</h3>
          {add("social", current ? "Record new version" : "Record social history")}
        </div>
        {opened === "social" ? (
          <SocialVersionForm patientId={patientId} current={current} sensitiveAccess={history.sensitiveAccess} encounterId={encounterId} onDone={close} />
        ) : null}
        {current ? (
          <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
            <p className="text-meta text-muted-foreground">
              As of {clinicalDate(current.effectiveDate)} · recorded {clinicalDateTime(current.recordedAt)}
              {current.recordedByName ? ` by ${current.recordedByName}` : ""}
            </p>
            <SocialHistoryDetails version={current} />
            {canRecord ? <InErrorAction patientId={patientId} entryId={current.id} encounterId={encounterId} what="Version" /> : null}
          </div>
        ) : (
          <p className="text-table text-muted-foreground">Social history not recorded.</p>
        )}
        {!compact && history.social.versions.length > (current ? 1 : 0) ? (
          <details className="rounded-md border p-2.5">
            <summary className="flex cursor-pointer items-center gap-1.5 text-table">
              <HistoryIcon className="size-4" aria-hidden /> Earlier versions ({history.social.versions.filter((v) => !v.current).length})
            </summary>
            <ul className="mt-2 flex flex-col divide-y">
              {history.social.versions
                .filter((v) => !v.current)
                .map((v) => (
                  <li key={v.id} className="flex flex-col gap-1 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={v.enteredInError ? "text-table line-through" : "text-table font-medium"}>As of {clinicalDate(v.effectiveDate)}</span>
                      {v.enteredInError ? <InErrorBadge /> : <Badge variant="neutral">Replaced</Badge>}
                    </div>
                    <SocialHistoryDetails version={v} />
                    <Recorded entry={v} filedUnder={filedUnderText(filedUnder(v.patientId))} />
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function ProcedureRow({
  entry: p,
  patientId,
  canRecord,
  encounterId,
  filedUnder,
}: {
  entry: PastProcedure;
  patientId: string;
  canRecord: boolean;
  encounterId?: string;
  filedUnder: string | null;
}) {
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={p.enteredInError ? "text-body line-through" : "text-body font-medium"}>
          {partialDateLabel(p.performed, p.performedPrecision, clinicalDate)} · {p.description}
          {p.bodySite ? ` (${p.bodySite})` : ""}
        </span>
        <SourceBadge source={p.source} reportedBy={p.reportedBy} />
        {p.enteredInError ? <InErrorBadge /> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {[
          p.performer,
          p.code ? `${p.codeSystem}: ${p.code}` : null,
          p.sourceDescription ? `source: ${p.sourceDescription}` : null,
          p.declaredSource ? `from ${p.declaredSource}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {p.notes ? <p className="text-meta">Note: {p.notes}</p> : null}
      <Recorded entry={p} filedUnder={filedUnder} />
      {canRecord && !p.enteredInError ? <InErrorAction patientId={patientId} entryId={p.id} encounterId={encounterId} what="Procedure" /> : null}
    </li>
  );
}

function ConditionRow({
  entry: c,
  patientId,
  canRecord,
  encounterId,
  filedUnder,
}: {
  entry: PastCondition;
  patientId: string;
  canRecord: boolean;
  encounterId?: string;
  filedUnder: string | null;
}) {
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={c.enteredInError ? "text-body line-through" : "text-body font-medium"}>
          {c.description}
          {c.onset ? ` · since ${partialDateLabel(c.onset, c.onsetPrecision, clinicalDate)}` : ""}
        </span>
        <Badge variant="outline">{CONDITION_STATUS_LABEL[c.status]}</Badge>
        <SourceBadge source={c.source} reportedBy={c.reportedBy} />
        {c.enteredInError ? <InErrorBadge /> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {[
          c.diagnosedBy ? `diagnosed at ${c.diagnosedBy}` : null,
          c.code ? `${c.codeSystem}: ${c.code}` : null,
          c.sourceDescription ? `source: ${c.sourceDescription}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {c.notes ? <p className="text-meta">Note: {c.notes}</p> : null}
      <Recorded entry={c} filedUnder={filedUnder} />
      {canRecord && !c.enteredInError ? <InErrorAction patientId={patientId} entryId={c.id} encounterId={encounterId} what="Condition" /> : null}
    </li>
  );
}

function MedicationRow({
  entry: m,
  patientId,
  canRecord,
  encounterId,
  filedUnder,
}: {
  entry: ReportedMedication;
  patientId: string;
  canRecord: boolean;
  encounterId?: string;
  filedUnder: string | null;
}) {
  const period = medicationPeriodLabel(m, clinicalDate);
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={m.enteredInError ? "text-body line-through" : "text-body font-medium"}>
          {m.medication}
          {m.dose ? ` — ${m.dose}` : ""}
        </span>
        <MedicationStatusBadge status={m.status} />
        <SourceBadge source={m.source} reportedBy={m.reportedBy} />
        {m.enteredInError ? <InErrorBadge /> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {[
          m.reason ? `for ${m.reason}` : null,
          period,
          m.prescribedBy ? `from ${m.prescribedBy}` : null,
          m.code ? `${m.codeSystem}: ${m.code}` : null,
          m.sourceDescription ? `source: ${m.sourceDescription}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {m.notes ? <p className="text-meta">Note: {m.notes}</p> : null}
      {m.stopRecorded ? (
        <p className="text-meta">
          Marked stopped {clinicalDateTime(m.stopRecorded.at)}
          {m.stopRecorded.byName ? ` by ${m.stopRecorded.byName}` : ""}
          {m.stopRecorded.note ? ` — ${m.stopRecorded.note}` : ""}
        </p>
      ) : null}
      <Recorded entry={m} filedUnder={filedUnder} />
      {canRecord && !m.enteredInError ? (
        <div className="flex flex-wrap items-start gap-1.5">
          {m.status !== "stopped" ? <StopMedicationAction patientId={patientId} entryId={m.id} encounterId={encounterId} /> : null}
          <InErrorAction patientId={patientId} entryId={m.id} encounterId={encounterId} what="Medicine" />
        </div>
      ) : null}
    </li>
  );
}

/** Taking / stopped / not known: colour + icon + text. */
export function MedicationStatusBadge({ status }: { status: ReportedMedication["status"] }) {
  const Icon = status === "taking" ? PillIcon : status === "stopped" ? CheckCircle2Icon : CircleHelpIcon;
  return (
    <Badge variant={status === "taking" ? "info" : "neutral"}>
      <Icon aria-hidden /> {status === "taking" ? "Taking" : status === "stopped" ? "Stopped" : "Not known"}
    </Badge>
  );
}

function FamilyRow({
  entry: f,
  patientId,
  canRecord,
  encounterId,
  filedUnder,
}: {
  entry: FamilyHistoryEntry;
  patientId: string;
  canRecord: boolean;
  encounterId?: string;
  filedUnder: string | null;
}) {
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={f.enteredInError ? "text-body line-through" : "text-body font-medium"}>
          {f.relative}: {f.condition}
          {f.onsetAge !== null ? ` (from age ${f.onsetAge})` : ""}
        </span>
        {f.deceased ? <Badge variant="neutral">Deceased{f.causeOfDeath ? ` — ${f.causeOfDeath}` : ""}</Badge> : null}
        <SourceBadge source={f.source} reportedBy={f.reportedBy} />
        {f.enteredInError ? <InErrorBadge /> : null}
      </div>
      {f.notes ? <p className="text-meta">Note: {f.notes}</p> : null}
      <Recorded entry={f} filedUnder={filedUnder} />
      {canRecord && !f.enteredInError ? <InErrorAction patientId={patientId} entryId={f.id} encounterId={encounterId} what="Entry" /> : null}
    </li>
  );
}

/** A short summary for cards: counts, the family history state and tobacco/alcohol use (never the sensitive parts). */
export function HistorySummary({ history }: { history: PatientHistory }) {
  const procedures = history.procedures.filter((p) => !p.enteredInError);
  const conditions = history.conditions.filter((c) => !c.enteredInError);
  const medications = history.medications.filter((m) => !m.enteredInError && m.status !== "stopped");
  const current = history.social.current;
  return (
    <div className="flex flex-col gap-2 text-table">
      <FamilyStateBadge state={history.family.state} latestReview={history.family.latestReview} />
      <p>
        <span className="text-muted-foreground">Past procedures:</span>{" "}
        {procedures.length
          ? procedures
              .slice(0, 4)
              .map((p) => `${p.description} (${partialDateLabel(p.performed, p.performedPrecision, clinicalDate)})`)
              .join("; ")
          : "none recorded"}
        {procedures.length > 4 ? ` and ${procedures.length - 4} more` : ""}
      </p>
      <p>
        <span className="text-muted-foreground">Past conditions:</span>{" "}
        {conditions.length
          ? conditions
              .slice(0, 4)
              .map((c) => c.description)
              .join("; ")
          : "none recorded"}
        {conditions.length > 4 ? ` and ${conditions.length - 4} more` : ""}
      </p>
      {medications.length ? (
        <p>
          <span className="text-muted-foreground">Medicines from elsewhere:</span>{" "}
          {medications
            .slice(0, 4)
            .map((m) => m.medication)
            .join("; ")}
          {medications.length > 4 ? ` and ${medications.length - 4} more` : ""}
        </p>
      ) : null}
      {history.family.entries.some((e) => !e.enteredInError) ? (
        <p>
          <span className="text-muted-foreground">Family:</span>{" "}
          {history.family.entries
            .filter((e) => !e.enteredInError)
            .slice(0, 4)
            .map((e) => `${e.relative} — ${e.condition}`)
            .join("; ")}
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">Social:</span>{" "}
        {current
          ? [
              tobaccoText(current) ? `tobacco ${tobaccoText(current)!.toLowerCase()}` : null,
              alcoholText(current) ? `alcohol ${alcoholText(current)!.toLowerCase()}` : null,
              current.occupation,
            ]
              .filter(Boolean)
              .join(" · ") || "recorded"
          : "not recorded"}
      </p>
    </div>
  );
}
