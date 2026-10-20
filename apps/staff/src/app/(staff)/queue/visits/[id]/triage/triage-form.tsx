"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  RadioGroup,
  RadioGroupTile,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import type { ServicePoint, VisitPriority } from "@/lib/api/types";
import { RouteStopsEditor } from "@/components/route-stops-editor";
import { defaultServicePoint, SERVICE_POINT_KIND_LABEL } from "@/lib/clinic-mapping";
import { addComplaint, COMMON_COMPLAINTS, outOfRange, RISK_FLAG_PRESETS, toggleFlag, vitalHints, type HintKey } from "@/lib/triage-flags";
import { bmi, EMPTY_VITALS, parseRiskFlags, parseVitals, VITAL_FIELDS, type VitalField, vitalErrorsFromApi, type VitalsForm } from "@/lib/triage-form";
import { recordTriage } from "./actions";

const PRIORITIES: Array<{ value: VisitPriority; label: string; description: string }> = [
  { value: "routine", label: "Routine", description: "Seen in queue order" },
  { value: "urgent", label: "Urgent", description: "Seen before routine" },
  { value: "emergency", label: "Emergency", description: "Seen first" },
];

const PRIORITY_LABEL: Record<VisitPriority, string> = { routine: "Routine", urgent: "Urgent", emergency: "Emergency" };

export function TriageForm({
  visit,
  servicePoints,
  canConfigureServicePoints,
  ageYears,
  aside,
}: {
  visit: { id: string; ticket: string; chiefComplaint: string; priority: VisitPriority; servicePointId: string | null; plannedStops: string[] };
  /** The facility's active service points (migration 0113), plus the visit's own if it was deactivated since (the page filters). */
  servicePoints: ServicePoint[];
  /** Whether to offer the link that sets service points up. */
  canConfigureServicePoints: boolean;
  /** The patient's age; the adult reference bands are not applied under 18. */
  ageYears: number;
  /** Allergies and previous vitals, drawn by the page under the figures taken from this form. */
  aside: React.ReactNode;
}) {
  const router = useRouter();
  const [chiefComplaint, setChiefComplaint] = React.useState(visit.chiefComplaint);
  const [priority, setPriority] = React.useState<VisitPriority>(visit.priority);
  const [servicePointId, setServicePointId] = React.useState(() => defaultServicePoint(servicePoints, visit.servicePointId));
  const sendTo = servicePoints.find((s) => s.id === servicePointId);
  const [stops, setStops] = React.useState<string[]>(visit.plannedStops);
  const active = servicePoints.filter((s) => s.status === "active");
  const [painScore, setPainScore] = React.useState("na");
  const [flags, setFlags] = React.useState<string[]>([]);
  const [otherOpen, setOtherOpen] = React.useState(false);
  const [otherFlags, setOtherFlags] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [vitals, setVitals] = React.useState<VitalsForm>(EMPTY_VITALS);
  const [vitalErrors, setVitalErrors] = React.useState<Partial<Record<VitalField, string>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const parsed = parseVitals(vitals);
  // The bands are for adults: for a child they would mislead, so only the plain BMI figure is shown and nothing is flagged.
  const adult = ageYears >= 18;
  const childBmi = bmi(parsed.values.weightKg, parsed.values.heightCm);
  const hints = adult ? vitalHints(parsed.values) : childBmi !== null ? { bmi: { text: `BMI ${childBmi}`, flagged: false } } : {};
  const flagged = adult ? outOfRange(parsed.values) : [];

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
        painScore: painScore === "na" ? undefined : Number(painScore),
        riskFlags: parseRiskFlags([...flags, otherFlags].join(",")),
        notes: notes.trim() || undefined,
        vitals: values,
        completeTriage,
        servicePointId: servicePointId || undefined,
        route: servicePointId && stops.length > 0 ? stops : undefined,
      });
      if (result.ok) {
        const then = servicePointId && stops.length > 0 ? `, then ${stops.map((id) => servicePoints.find((s) => s.id === id)?.name ?? "…").join(" → ")}` : "";
        const where = sendTo && sendTo.id !== visit.servicePointId ? ` · sent to ${sendTo.name}${then}` : then ? ` · route${then}` : "";
        toast.success(completeTriage ? `${visit.ticket}: triage complete, ready for provider${where}` : `${visit.ticket}: triage saved${where}`);
        router.push("/queue");
        return;
      }
      if (result.code === "implausible_vital_signs") setVitalErrors(vitalErrorsFromApi(result.details));
      setError(result.message);
    });
  };

  const setVital = (field: VitalField, value: string) => setVitals((v) => ({ ...v, [field]: value }));

  /** One measurement: a large field with its unit inside, the band or reading under it, red when outside the band. */
  const vitalInput = (field: VitalField, hintKey?: HintKey) => {
    const spec = VITAL_FIELDS[field];
    const message = vitalErrors[field];
    const hint = hintKey ? hints[hintKey] : undefined;
    return (
      <div className="grid content-start gap-1">
        <Label htmlFor={field}>{spec.label}</Label>
        <div className="relative">
          <Input
            id={field}
            inputMode="decimal"
            autoComplete="off"
            className={cn("tabular h-12 pr-16 text-lg", hint?.flagged && "border-danger/50 bg-danger-subtle text-danger-foreground")}
            aria-invalid={!!message}
            aria-describedby={message ? `${field}-error` : hint?.text ? `${field}-hint` : undefined}
            value={vitals[field]}
            onChange={(e) => setVital(field, e.target.value)}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-meta text-muted-foreground">{spec.unit}</span>
        </div>
        {message ? (
          <p id={`${field}-error`} className="text-meta text-danger-foreground">
            {message}
          </p>
        ) : hint?.text ? (
          <p id={`${field}-hint`} className={cn("text-meta", hint.flagged ? "font-medium text-danger-foreground" : "text-muted-foreground")}>
            {hint.text}
          </p>
        ) : null}
      </div>
    );
  };

  const bpMessage = vitalErrors.systolicMmhg ?? vitalErrors.diastolicMmhg;
  const bpHint = "bp" in hints ? hints.bp : undefined;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid flex-1 content-start gap-4 p-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <Section n={1} title="Chief complaint" required>
            <Textarea
              id="chiefComplaint"
              aria-label="Chief complaint"
              maxLength={500}
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-meta text-muted-foreground">Common:</span>
              {COMMON_COMPLAINTS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => setChiefComplaint((current) => addComplaint(current, c))}
                >
                  {c}
                </Button>
              ))}
            </div>
          </Section>

          <Section n={2} title="Vital signs" aside="Leave blank what wasn't measured · Tab moves to the next field">
            {adult ? null : (
              <p className="text-table text-muted-foreground">
                Adult reference bands are not shown for patients under 18. Read the values against your own references.
              </p>
            )}
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid content-start gap-1">
                <span id="bp-label" className="text-table font-medium">
                  Blood pressure
                </span>
                <div
                  role="group"
                  aria-labelledby="bp-label"
                  className={cn(
                    "flex h-12 items-center gap-1 rounded-md border bg-card px-3 focus-within:ring-[3px] focus-within:ring-ring/50",
                    bpHint?.flagged && "border-danger/50 bg-danger-subtle text-danger-foreground",
                    bpMessage && "border-danger",
                  )}
                >
                  <Input
                    id="systolicMmhg"
                    aria-label="Systolic pressure"
                    inputMode="numeric"
                    autoComplete="off"
                    className="tabular h-full w-12 border-0 bg-transparent px-0 text-right text-lg shadow-none focus-visible:ring-0"
                    aria-invalid={!!vitalErrors.systolicMmhg}
                    value={vitals.systolicMmhg}
                    onChange={(e) => setVital("systolicMmhg", e.target.value)}
                  />
                  <span aria-hidden className="text-lg text-muted-foreground">
                    /
                  </span>
                  <Input
                    id="diastolicMmhg"
                    aria-label="Diastolic pressure"
                    inputMode="numeric"
                    autoComplete="off"
                    className="tabular h-full w-12 border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
                    aria-invalid={!!vitalErrors.diastolicMmhg}
                    value={vitals.diastolicMmhg}
                    onChange={(e) => setVital("diastolicMmhg", e.target.value)}
                  />
                  <span className="ml-auto pl-1 text-meta text-muted-foreground">mmHg</span>
                </div>
                {bpMessage ? (
                  <p role="alert" className="text-meta text-danger-foreground">
                    {bpMessage}
                  </p>
                ) : (
                  <p className={cn("text-meta", bpHint?.flagged ? "font-medium text-danger-foreground" : "text-muted-foreground")}>{bpHint?.text}</p>
                )}
              </div>
              {vitalInput("heartRateBpm", "heartRate")}
              {vitalInput("respiratoryRateBpm", "respiratoryRate")}
              {vitalInput("temperatureC", "temperatureC")}
              {vitalInput("spo2Percent", "spo2")}
              {vitalInput("weightKg")}
              {vitalInput("heightCm", "bmi")}
              {vitalInput("bloodGlucoseMgDl", "glucose")}
            </div>
          </Section>

          <Section n={3} title="Priority & risk">
            <div className="grid gap-1.5">
              <p id="priority-label" className="text-table font-medium">
                Priority <span className="text-danger-foreground">*</span>
                <span className="font-normal text-muted-foreground"> · urgent and emergency are seen first</span>
              </p>
              <RadioGroup
                aria-labelledby="priority-label"
                value={priority}
                onValueChange={(v) => setPriority(v as VisitPriority)}
                className="gap-3 sm:grid-cols-3"
              >
                {PRIORITIES.map((p) => (
                  <RadioGroupTile key={p.value} value={p.value} className="px-4 py-3">
                    <span className="block text-body font-semibold">{p.label}</span>
                    <span className={cn("block text-table font-normal", priority === p.value ? "text-primary" : "text-muted-foreground")}>{p.description}</span>
                  </RadioGroupTile>
                ))}
              </RadioGroup>
            </div>

            <div className="grid gap-1.5">
              <p id="pain-label" className="text-table font-medium">
                Pain score <span className="font-normal text-muted-foreground">· {painScore === "na" ? "not assessed" : `${painScore} / 10`}</span>
              </p>
              <RadioGroup aria-labelledby="pain-label" value={painScore} onValueChange={setPainScore} className="grid-cols-6 gap-2 sm:grid-cols-12">
                {["na", ...Array.from({ length: 11 }, (_, n) => String(n))].map((value) => (
                  <RadioGroupTile
                    key={value}
                    value={value}
                    aria-label={value === "na" ? "Pain not assessed" : `Pain ${value} of 10`}
                    className="h-10 px-0 text-center text-body font-medium data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                  >
                    {value === "na" ? "N/A" : value}
                  </RadioGroupTile>
                ))}
              </RadioGroup>
            </div>

            <div className="grid gap-1.5">
              <p className="text-table font-medium">Risk flags</p>
              <div className="flex flex-wrap gap-2">
                {RISK_FLAG_PRESETS.map((flag) => {
                  const on = flags.some((f) => f.toLowerCase() === flag.toLowerCase());
                  return (
                    <Button
                      key={flag}
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={on}
                      className={cn("rounded-full", on && "border-primary bg-primary-subtle text-primary")}
                      onClick={() => setFlags((current) => toggleFlag(current, flag))}
                    >
                      {on ? <CheckIcon aria-hidden /> : null}
                      {flag}
                    </Button>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-expanded={otherOpen}
                  className="rounded-full border-dashed text-muted-foreground"
                  onClick={() => setOtherOpen((open) => !open)}
                >
                  + Other
                </Button>
              </div>
              {otherOpen ? (
                <Input
                  aria-label="Other risk flags"
                  value={otherFlags}
                  onChange={(e) => setOtherFlags(e.target.value)}
                  placeholder="Comma-separated, e.g. oxygen dependent, allergic to latex"
                />
              ) : null}
            </div>
          </Section>

          <Section n={4} title="Notes for the provider">
            <Textarea
              id="notes"
              aria-label="Notes for the provider"
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the doctor should know before they see the patient"
            />
          </Section>

          {servicePoints.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Route</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="servicePointId">Send to</Label>
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
                    Where the patient goes next, recorded with the triage. Leave it on “Choose…” to keep the ordinary consultation line.
                  </p>
                </div>
                {active.length > 0 ? (
                  <div className="grid gap-1">
                    <RouteStopsEditor
                      id="routeStop"
                      servicePoints={active}
                      stops={stops}
                      after={servicePointId || null}
                      disabled={!servicePointId}
                      onChange={setStops}
                    />
                    <p className="text-meta text-muted-foreground">
                      {servicePointId
                        ? "The stops after that one, in order. From the queue, “Done here, send on” moves the patient to the next stop."
                        : "Choose where to send the patient first; the stops after it are planned from there."}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </fieldset>

        <aside className="flex flex-col gap-3 self-start">
          {flagged.length > 0 ? (
            <section aria-label="From these vitals" className="rounded-xl border border-warning/40 bg-warning-subtle p-4 text-warning-foreground">
              <p className="text-meta font-semibold tracking-wide uppercase">From these vitals</p>
              <p className="mt-2 flex items-center gap-1.5 text-body font-semibold">
                <TriangleAlertIcon className="size-4" aria-hidden />
                {flagged.length} {flagged.length === 1 ? "reading" : "readings"} out of range
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-table">
                {flagged.map((r) => (
                  <li key={r.key}>
                    {r.label} {r.text} — {r.interpretation}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-meta">Adult reference bands, as guidance only. The priority is the nurse&apos;s decision.</p>
              {priority === "routine" ? (
                <Button type="button" className="mt-3 w-full" onClick={() => setPriority("urgent")}>
                  Set priority to Urgent
                </Button>
              ) : (
                <p className="mt-3 text-table font-medium">Priority is {PRIORITY_LABEL[priority]}.</p>
              )}
            </section>
          ) : null}
          {aside}
        </aside>
      </div>

      <div className="sticky -bottom-20 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t bg-card py-3 pr-20 pl-4 sm:pl-6">
        <div className="min-w-0 flex-1 text-table">
          <p>
            <b className="font-semibold">Next:</b> Ready for provider · {sendTo ? sendTo.name : "consultation line"}
          </p>
          {servicePoints.length === 0 ? (
            <p className="text-meta text-muted-foreground">
              No service points set up yet.{" "}
              {canConfigureServicePoints ? (
                <Link href="/admin/service-points" className="text-primary underline underline-offset-2">
                  Set up rooms
                </Link>
              ) : (
                "Ask an administrator to set up rooms"
              )}{" "}
              to route patients to a specific room.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/queue">Cancel</Link>
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit(false)}>
            <SaveIcon /> Save draft
          </Button>
          <Button type="submit" disabled={pending}>
            <CheckIcon /> {pending ? "Saving…" : "Complete triage"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({ n, title, required, aside, children }: { n: number; title: string; required?: boolean; aside?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-primary">{n}</span> · {title}
          {required ? <span className="text-danger-foreground"> *</span> : null}
        </CardTitle>
        {aside ? <span className="ml-auto text-meta font-normal text-muted-foreground">{aside}</span> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
