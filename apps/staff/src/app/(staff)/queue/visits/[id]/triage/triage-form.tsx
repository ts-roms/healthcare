"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, SaveIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { ServicePoint, VisitPriority } from "@/lib/api/types";
import { defaultServicePoint, SERVICE_POINT_KIND_LABEL } from "@/lib/clinic-mapping";
import { bmi, EMPTY_VITALS, parseRiskFlags, parseVitals, VITAL_FIELDS, type VitalField, vitalErrorsFromApi, type VitalsForm } from "@/lib/triage-form";
import { recordTriage } from "./actions";

const VITAL_LAYOUT: VitalField[] = [
  "systolicMmhg",
  "diastolicMmhg",
  "heartRateBpm",
  "respiratoryRateBpm",
  "temperatureC",
  "spo2Percent",
  "weightKg",
  "heightCm",
  "bloodGlucoseMgDl",
];

export function TriageForm({
  visit,
  patientId,
  servicePoints,
}: {
  visit: { id: string; ticket: string; chiefComplaint: string; priority: VisitPriority; servicePointId: string | null };
  patientId: string;
  /** The facility's active service points (migration 0113), plus the visit's own if it was deactivated since (the page filters). */
  servicePoints: ServicePoint[];
}) {
  const router = useRouter();
  const [chiefComplaint, setChiefComplaint] = React.useState(visit.chiefComplaint);
  const [priority, setPriority] = React.useState<VisitPriority>(visit.priority);
  const [servicePointId, setServicePointId] = React.useState(() => defaultServicePoint(servicePoints, visit.servicePointId));
  const sendTo = servicePoints.find((s) => s.id === servicePointId);
  const [painScore, setPainScore] = React.useState("");
  const [riskFlags, setRiskFlags] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [vitals, setVitals] = React.useState<VitalsForm>(EMPTY_VITALS);
  const [vitalErrors, setVitalErrors] = React.useState<Partial<Record<VitalField, string>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const parsed = parseVitals(vitals);
  const computedBmi = bmi(parsed.values.weightKg, parsed.values.heightCm);

  const submit = (completeTriage: boolean) => {
    setError(null);
    const { values, errors } = parseVitals(vitals);
    setVitalErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Check the highlighted vital signs.");
      return;
    }
    if (!chiefComplaint.trim()) {
      setError("Record the chief complaint.");
      return;
    }
    startTransition(async () => {
      const result = await recordTriage({
        visitId: visit.id,
        chiefComplaint: chiefComplaint.trim(),
        priority,
        painScore: painScore === "" ? undefined : Number(painScore),
        riskFlags: parseRiskFlags(riskFlags),
        notes: notes.trim() || undefined,
        vitals: values,
        completeTriage,
        servicePointId: servicePointId || undefined,
      });
      if (result.ok) {
        const where = sendTo && sendTo.id !== visit.servicePointId ? ` · sent to ${sendTo.name}` : "";
        toast.success(completeTriage ? `${visit.ticket}: triage complete, ready for provider${where}` : `${visit.ticket}: triage saved${where}`);
        router.push("/queue");
        return;
      }
      if (result.code === "implausible_vital_signs") setVitalErrors(vitalErrorsFromApi(result.details));
      setError(result.message);
    });
  };

  const vitalInput = (field: VitalField) => {
    const spec = VITAL_FIELDS[field];
    const message = vitalErrors[field];
    return (
      <div className="grid content-start gap-1">
        <Label htmlFor={field}>
          {spec.label} <span className="font-normal text-muted-foreground">({spec.unit})</span>
        </Label>
        <Input
          id={field}
          inputMode="decimal"
          autoComplete="off"
          className="tabular"
          aria-invalid={!!message}
          aria-describedby={message ? `${field}-error` : undefined}
          value={vitals[field]}
          onChange={(e) => setVitals((v) => ({ ...v, [field]: e.target.value }))}
        />
        {message ? (
          <p id={`${field}-error`} className="text-meta text-danger-foreground">
            {message}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      className="flex flex-col gap-4"
    >
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Assessment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="chiefComplaint">Chief complaint *</Label>
              <Textarea id="chiefComplaint" maxLength={500} value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="priority">Priority *</Label>
              <NativeSelect id="priority" value={priority} onChange={(e) => setPriority(e.target.value as VisitPriority)}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </NativeSelect>
              <p className="text-meta text-muted-foreground">Set by the triaging nurse; urgent and emergency are seen first.</p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="painScore">Pain score (0–10)</Label>
              <NativeSelect id="painScore" value={painScore} onChange={(e) => setPainScore(e.target.value)}>
                <option value="">Not assessed</option>
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="riskFlags">Risk flags</Label>
              <Input
                id="riskFlags"
                value={riskFlags}
                onChange={(e) => setRiskFlags(e.target.value)}
                placeholder="Comma-separated, e.g. fall risk, pregnant, infectious symptoms"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vital signs</CardTitle>
            <span className="text-meta text-muted-foreground">Optional · leave blank what was not measured</span>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            {VITAL_LAYOUT.map((f) => (
              <React.Fragment key={f}>{vitalInput(f)}</React.Fragment>
            ))}
            <div className="grid content-start gap-1">
              <span className="text-table font-medium">BMI</span>
              <span className="tabular py-1.5 text-body">{computedBmi ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-1">
          <Label htmlFor="notes">Triage notes</Label>
          <Textarea id="notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Send to</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="servicePointId">Service point</Label>
              <NativeSelect
                id="servicePointId"
                value={servicePointId}
                placeholder="Choose…"
                emptyText="No service points set up"
                onChange={(e) => setServicePointId(e.target.value)}
              >
                {servicePoints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {SERVICE_POINT_KIND_LABEL[s.kind]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-meta text-muted-foreground">
                {servicePoints.length === 0
                  ? "Your clinic has not set up service points; the patient stays on the consultation line."
                  : "Where the patient goes next, recorded with the triage. Leave it on “Choose…” to keep the ordinary consultation line."}
              </p>
            </div>
          </CardContent>
        </Card>
      </fieldset>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <CheckIcon /> {pending ? "Saving…" : "Complete triage — ready for provider"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit(false)}>
          <SaveIcon /> Save, keep in triage
        </Button>
        <Button asChild variant="ghost">
          <Link href="/queue">Cancel</Link>
        </Button>
        <Button asChild variant="link" className="ml-auto">
          <Link href={`/patients/${patientId}`}>Patient record</Link>
        </Button>
      </div>
    </form>
  );
}
