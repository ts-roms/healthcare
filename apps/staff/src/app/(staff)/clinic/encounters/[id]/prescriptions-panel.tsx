"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, InfoIcon, PillIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Allergy } from "@healthcare/domain";
import { AllergyBadge, clinicalDateTime } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Kbd,
  Label,
  NativeSelect,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type { AllergyWarning, Prescription, PrescriptionFrequency, PrescriptionRoute } from "@/lib/api/types";
import type { PrescriptionControls } from "@/lib/encounter-mapping";
import { label } from "@/lib/patient-mapping";
import {
  blankLine,
  FREQUENCY_LABEL,
  type LineErrors,
  type LineField,
  type LineForm,
  lineSummary,
  linesFromPrescription,
  OVERRIDE_MIN_LENGTH,
  parseLines,
  ROUTE_LABEL,
} from "@/lib/prescription-form";
import { cancelPrescription, issuePrescription, replacePrescription } from "../prescription-actions";

type AllergyStatus = "has_allergies" | "no_known_allergies" | "not_reviewed" | "unknown";

const STATUS_BADGE: Record<Prescription["status"], { text: string; variant: "success" | "neutral" | "warning" }> = {
  active: { text: "Active", variant: "success" },
  superseded: { text: "Superseded", variant: "neutral" },
  cancelled: { text: "Cancelled", variant: "warning" },
};

export function PrescriptionsPanel({
  encounterId,
  prescriptions,
  controls,
  allergies,
  allergyStatus,
}: {
  encounterId: string;
  /** null: the user may not read prescriptions. */
  prescriptions: Prescription[] | null;
  controls: PrescriptionControls;
  allergies: Allergy[];
  allergyStatus: AllergyStatus;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ mode: "issue" } | { mode: "replace"; prescription: Prescription } | null>(null);
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  // Alt+P opens a new prescription — clinicians shouldn't need the mouse.
  React.useEffect(() => {
    if (!controls.issue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setEditing({ mode: "issue" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls.issue]);

  if (prescriptions === null) return null;

  return (
    <section aria-labelledby="rx-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id="rx-heading" className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          Prescriptions
        </h3>
        {controls.issue ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setEditing({ mode: "issue" })}>
            <PlusIcon /> New prescription <Kbd className="ml-1 hidden md:inline-flex">Alt P</Kbd>
          </Button>
        ) : null}
      </div>
      {prescriptions.length === 0 ? <p className="text-table text-muted-foreground">No prescription issued in this encounter.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {prescriptions.map((p) => (
          <li key={p.id} className="rounded-md border bg-card px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-table">
              <PillIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-mono font-semibold">{p.prescriptionNumber}</span>
              <Badge variant={STATUS_BADGE[p.status].variant}>{STATUS_BADGE[p.status].text}</Badge>
              <span className="tabular text-muted-foreground">{clinicalDateTime(p.issuedAt)}</span>
              {p.allergyWarnings.length ? (
                <Badge variant="critical">
                  <AlertTriangleIcon aria-hidden /> Allergy warning overridden
                </Badge>
              ) : null}
              <span className="ml-auto flex gap-1">
                {controls.replace(p) ? (
                  <Button size="xs" variant="ghost" onClick={() => setEditing({ mode: "replace", prescription: p })}>
                    Replace…
                  </Button>
                ) : null}
                {controls.cancel(p) ? (
                  <Button size="xs" variant="ghost" onClick={() => setCancelling(p.id)}>
                    Cancel…
                  </Button>
                ) : null}
              </span>
            </div>
            <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-table">
              {p.items.map((i) => (
                <li key={i.id} className={p.status === "active" ? "" : "text-muted-foreground line-through"}>
                  {lineSummary(i)}
                  <span className="block text-muted-foreground no-underline">{i.instructions}</span>
                </li>
              ))}
            </ol>
            {p.allergyOverrideReason ? <p className="text-meta text-muted-foreground">Override reason: {p.allergyOverrideReason}</p> : null}
            {p.cancellationReason ? <p className="text-meta text-muted-foreground">Reason: {p.cancellationReason}</p> : null}
            {cancelling === p.id ? (
              <form
                className="mt-1.5 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    const result = await cancelPrescription({ prescriptionId: p.id, reason: cancelReason });
                    if (result.ok) {
                      toast.success(`${p.prescriptionNumber} cancelled`);
                      setCancelling(null);
                      setCancelReason("");
                      router.refresh();
                    } else toast.error(result.message);
                  });
                }}
              >
                <div className="grid min-w-56 flex-1 gap-1">
                  <Label htmlFor={`rx-cancel-${p.id}`}>Why cancel? *</Label>
                  <Input id={`rx-cancel-${p.id}`} autoFocus maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </div>
                <Button type="submit" size="sm" variant="destructive" disabled={pending || cancelReason.trim().length < 5}>
                  Cancel prescription
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(null)}>
                  Keep
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <PrescriptionDialog
        key={editing ? (editing.mode === "replace" ? editing.prescription.id : "issue") : "closed"}
        state={editing}
        encounterId={encounterId}
        allergies={allergies}
        allergyStatus={allergyStatus}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function PrescriptionDialog({
  state,
  encounterId,
  allergies,
  allergyStatus,
  onClose,
}: {
  state: { mode: "issue" } | { mode: "replace"; prescription: Prescription } | null;
  encounterId: string;
  allergies: Allergy[];
  allergyStatus: AllergyStatus;
  onClose: () => void;
}) {
  const router = useRouter();
  const replacing = state?.mode === "replace" ? state.prescription : null;
  const [lines, setLines] = React.useState<LineForm[]>(() => (replacing ? linesFromPrescription(replacing) : [blankLine()]));
  const [errors, setErrors] = React.useState<LineErrors[]>([]);
  const [notes, setNotes] = React.useState(replacing?.notes ?? "");
  const [reason, setReason] = React.useState("");
  const [warnings, setWarnings] = React.useState<AllergyWarning[] | null>(null);
  const [override, setOverride] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // One key per attempt; a resubmission with an override is a new attempt.
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());

  const update = (index: number, field: LineField, value: string) => {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
    // Editing a medicine invalidates warnings computed for the previous list.
    if (field === "genericName" || field === "brandName") setWarnings(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseLines(lines);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setError(lines.length ? "Check the highlighted fields." : "Add at least one medicine.");
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const allergyOverrideReason = warnings ? override.trim() : undefined;
      const result = replacing
        ? await replacePrescription({ prescriptionId: replacing.id, items: parsed.items, reason, notes, allergyOverrideReason })
        : await issuePrescription({ encounterId, items: parsed.items, notes, allergyOverrideReason }, attemptKey);
      setAttemptKey(crypto.randomUUID());
      if (result.ok) {
        toast.success(
          replacing ? `${replacing.prescriptionNumber} replaced by ${result.data.prescriptionNumber}` : `Prescription ${result.data.prescriptionNumber} issued`,
        );
        onClose();
        router.refresh();
        return;
      }
      if (result.code === "allergy_warning") {
        const details = result.details as { warnings?: AllergyWarning[] } | undefined;
        setWarnings(details?.warnings ?? []);
        return;
      }
      setError(result.message);
    });
  };

  const field = (index: number, name: LineField, text: string, input: React.ReactNode, className = "") => (
    <div className={`grid content-start gap-1 ${className}`}>
      <Label htmlFor={`rx-${index}-${name}`} className="text-meta">
        {text}
      </Label>
      {input}
      {errors[index]?.[name] ? <p className="text-meta text-danger-foreground">{errors[index]?.[name]}</p> : null}
    </div>
  );
  const textInput = (index: number, name: LineField, props: React.ComponentProps<typeof Input> = {}) => (
    <Input
      id={`rx-${index}-${name}`}
      value={lines[index]?.[name] ?? ""}
      aria-invalid={!!errors[index]?.[name]}
      onChange={(e) => update(index, name, e.target.value)}
      {...props}
    />
  );

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{replacing ? `Replace ${replacing.prescriptionNumber}` : "New prescription"}</DialogTitle>
          <DialogDescription>
            {replacing
              ? "The current prescription becomes superseded and points to the new one. Both stay in the record."
              : "Issued prescriptions cannot be edited; correct them later with Replace."}
          </DialogDescription>
        </DialogHeader>

        <section aria-label="Recorded allergies" className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-table">
          <span className="font-medium">Allergies:</span>
          {allergyStatus === "unknown" ? (
            <span className="text-muted-foreground">not visible to you</span>
          ) : allergyStatus === "not_reviewed" ? (
            <span className="font-medium text-warning-foreground">not recorded — ask the patient before prescribing</span>
          ) : allergies.length ? (
            allergies.map((a) => <AllergyBadge key={a.id} allergy={a} />)
          ) : (
            <span className="text-muted-foreground">no known allergies (reviewed)</span>
          )}
        </section>

        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={pending} className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <fieldset key={line.key} className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-12">
                <legend className="px-1 text-meta font-semibold text-muted-foreground">Medicine {index + 1}</legend>
                {field(index, "genericName", "Generic name *", textInput(index, "genericName", { autoFocus: index === lines.length - 1 }), "sm:col-span-3")}
                {field(index, "brandName", "Brand", textInput(index, "brandName"), "sm:col-span-2")}
                {field(index, "strength", "Strength", textInput(index, "strength", { placeholder: "500 mg" }), "sm:col-span-2")}
                {field(index, "dosageForm", "Form", textInput(index, "dosageForm", { placeholder: "tablet" }), "sm:col-span-2")}
                {field(index, "doseAmount", "Dose", textInput(index, "doseAmount", { inputMode: "decimal", placeholder: "1" }), "sm:col-span-1")}
                {field(index, "doseUnit", "Dose unit", textInput(index, "doseUnit", { placeholder: "tablet" }), "sm:col-span-2")}
                {field(
                  index,
                  "route",
                  "Route *",
                  <NativeSelect id={`rx-${index}-route`} value={line.route} onChange={(e) => update(index, "route", e.target.value as PrescriptionRoute)}>
                    {Object.entries(ROUTE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>,
                  "sm:col-span-2",
                )}
                {field(
                  index,
                  "frequency",
                  "Frequency *",
                  <NativeSelect
                    id={`rx-${index}-frequency`}
                    value={line.frequency}
                    onChange={(e) => update(index, "frequency", e.target.value as PrescriptionFrequency)}
                  >
                    {Object.entries(FREQUENCY_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>,
                  "sm:col-span-2",
                )}
                {line.frequency === "custom"
                  ? field(index, "frequencyText", "Describe frequency *", textInput(index, "frequencyText"), "sm:col-span-3")
                  : line.frequency === "as_needed"
                    ? field(index, "asNeededReason", "As needed for *", textInput(index, "asNeededReason", { placeholder: "pain or fever" }), "sm:col-span-3")
                    : null}
                {field(index, "durationValue", "Duration", textInput(index, "durationValue", { inputMode: "numeric" }), "sm:col-span-1")}
                {field(
                  index,
                  "durationUnit",
                  "Unit",
                  <NativeSelect id={`rx-${index}-durationUnit`} value={line.durationUnit} onChange={(e) => update(index, "durationUnit", e.target.value)}>
                    <option value="">—</option>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                    <option value="months">months</option>
                  </NativeSelect>,
                  "sm:col-span-1",
                )}
                {field(index, "quantity", "Quantity *", textInput(index, "quantity", { inputMode: "decimal" }), "sm:col-span-1")}
                {field(index, "quantityUnit", "Qty unit *", textInput(index, "quantityUnit", { placeholder: "tablets" }), "sm:col-span-2")}
                {field(index, "refills", "Refills", textInput(index, "refills", { inputMode: "numeric" }), "sm:col-span-1")}
                {field(
                  index,
                  "instructions",
                  "Instructions for the patient *",
                  textInput(index, "instructions", { placeholder: "Take after meals" }),
                  "sm:col-span-11",
                )}
                <div className="flex items-end justify-end sm:col-span-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove medicine ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => {
                      setLines((ls) => ls.filter((_, i) => i !== index));
                      setErrors((es) => es.filter((_, i) => i !== index));
                      setWarnings(null);
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </fieldset>
            ))}
            <div>
              <Button type="button" size="sm" variant="outline" disabled={lines.length >= 20} onClick={() => setLines((ls) => [...ls, blankLine()])}>
                <PlusIcon /> Add medicine
              </Button>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rx-notes">Notes (for the pharmacist)</Label>
              <Textarea id="rx-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {replacing ? (
              <div className="grid gap-1">
                <Label htmlFor="rx-reason">Reason for replacing *</Label>
                <Input id="rx-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dose corrected" />
              </div>
            ) : null}
          </fieldset>

          {warnings ? (
            <section role="alert" className="flex flex-col gap-2 rounded-md border border-critical/50 bg-critical-subtle p-3">
              <p className="flex items-center gap-2 font-semibold text-critical">
                <AlertTriangleIcon className="size-4" aria-hidden /> Decision support: possible drug–allergy conflict
              </p>
              <ul className="flex flex-col gap-1 text-table">
                {warnings.map((w) => (
                  <li key={`${w.allergyId}-${w.medication}`}>
                    <span className="font-semibold">{w.medication}</span> matches the recorded allergy to <span className="font-semibold">{w.substance}</span>
                    {w.reaction ? ` (reaction: ${w.reaction})` : ""} · criticality {label(w.criticality)} · basis: name match
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                This check compares medicine names with recorded allergies only. It does not know drug classes or cross-reactivity. Change the medicine, or
                document why you are prescribing it anyway; the override is recorded in the audit trail.
              </p>
              <div className="grid gap-1">
                <Label htmlFor="rx-override">Reason for overriding *</Label>
                <Textarea id="rx-override" maxLength={1000} value={override} onChange={(e) => setOverride(e.target.value)} />
                <p className="text-meta text-muted-foreground">At least {OVERRIDE_MIN_LENGTH} characters.</p>
              </div>
            </section>
          ) : (
            <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              On submit, medicines are checked against recorded allergies by name (decision support). No warning does not mean a medicine is safe.
            </p>
          )}

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={warnings ? "critical" : "default"}
              disabled={pending || (replacing !== null && reason.trim().length < 5) || (warnings !== null && override.trim().length < OVERRIDE_MIN_LENGTH)}
            >
              {pending
                ? "Submitting…"
                : warnings
                  ? replacing
                    ? "Override and replace"
                    : "Override and issue"
                  : replacing
                    ? "Replace prescription"
                    : "Issue prescription"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
