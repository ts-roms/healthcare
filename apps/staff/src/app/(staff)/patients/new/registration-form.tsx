"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangleIcon, ExternalLinkIcon, UserPlusIcon } from "lucide-react";
import { clinicalDate, sexLabel } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
  Input,
  Label,
  NativeSelect,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type { DuplicateCandidate } from "@/lib/api/types";
import { label } from "@/lib/patient-mapping";
import { type RegistrationForm, registrationFormSchema } from "@/lib/patient-registration";
import { registerPatient } from "./actions";

const REASONS: Record<string, string> = {
  identifier_match: "Same identifier",
  exact_name_and_birth_date: "Same name and birth date",
  similar_name_and_birth_date: "Similar name, same birth date",
  contact_and_birth_date: "Same mobile/email and birth date",
  similar_name_and_transposed_birth_date: "Similar name, day/month swapped",
  similar_name_and_birth_year: "Similar name, same birth year",
};

export function RegistrationFormView() {
  const router = useRouter();
  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: { familyName: "", givenName: "", sex: undefined, birthDate: "", mobile: "", email: "", philhealthPin: "" },
  });
  const [candidates, setCandidates] = React.useState<DuplicateCandidate[] | null>(null);
  const [reviewed, setReviewed] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // One key per logical attempt: a network retry of the same attempt is de-duplicated by the API.
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());
  const errors = form.formState.errors;
  // DateInput takes string min/max; register() also types them as numbers, which it never sets here.
  const { min: _min, max: _max, ...birthDateField } = form.register("birthDate");

  const submit = (values: RegistrationForm, override?: { reviewedCandidateIds: string[]; reason: string }) => {
    setError(null);
    startTransition(async () => {
      const result = await registerPatient(values, attemptKey, override);
      setAttemptKey(crypto.randomUUID());
      if (result.ok) {
        toast.success(`Registered ${values.familyName.toUpperCase()}, ${values.givenName}`, { description: `Patient no. ${result.patient.patientNumber}` });
        router.push(`/patients/${result.patient.id}`);
        return;
      }
      if (result.kind === "duplicates") {
        setCandidates(result.candidates);
        setReviewed(new Set());
        return;
      }
      if (result.kind === "invalid") {
        for (const [field, message] of Object.entries(result.fieldErrors)) form.setError(field as keyof RegistrationForm, { message });
      }
      setError(result.message);
    });
  };

  const onSubmit = form.handleSubmit((values) => submit(values));
  const allReviewed = candidates !== null && candidates.every((c) => reviewed.has(c.patient.id));
  const hasCertain = candidates?.some((c) => c.level === "certain") ?? false;

  const field = (name: keyof RegistrationForm, labelText: string, input: React.ReactNode, hint?: string) => (
    <div className="grid gap-1">
      <Label htmlFor={name}>{labelText}</Label>
      {input}
      {errors[name]?.message ? (
        <p className="text-meta text-danger-foreground">{errors[name]?.message}</p>
      ) : hint ? (
        <p className="text-meta text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <fieldset disabled={pending || candidates !== null} className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {field(
                "familyName",
                "Family name *",
                <Input id="familyName" autoComplete="off" aria-invalid={!!errors.familyName} {...form.register("familyName")} />,
              )}
              {field(
                "givenName",
                "Given name *",
                <Input id="givenName" autoComplete="off" aria-invalid={!!errors.givenName} {...form.register("givenName")} />,
              )}
              {field("middleName", "Middle name", <Input id="middleName" autoComplete="off" {...form.register("middleName")} />)}
              {field("suffix", "Suffix", <Input id="suffix" placeholder="Jr., III" autoComplete="off" {...form.register("suffix")} />)}
              {field(
                "sex",
                "Sex *",
                <NativeSelect id="sex" aria-invalid={!!errors.sex} defaultValue="" {...form.register("sex")}>
                  <option value="" disabled>
                    Select…
                  </option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="intersex">Intersex</option>
                  <option value="unknown">Unknown</option>
                </NativeSelect>,
              )}
              <div className="grid gap-1">
                {field("birthDate", "Birth date *", <DateInput id="birthDate" aria-invalid={!!errors.birthDate} {...birthDateField} />)}
                <label className="flex items-center gap-2 text-table">
                  <Controller
                    control={form.control}
                    name="birthDateIsEstimated"
                    render={({ field }) => (
                      <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} onBlur={field.onBlur} ref={field.ref} />
                    )}
                  />{" "}
                  Estimated (exact date unknown)
                </label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; identifiers</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {field("mobile", "Mobile", <Input id="mobile" inputMode="tel" placeholder="0917 123 4567" {...form.register("mobile")} />)}
              {field("email", "Email", <Input id="email" type="email" {...form.register("email")} />)}
              {field(
                "philhealthPin",
                "PhilHealth PIN",
                <Input id="philhealthPin" inputMode="numeric" placeholder="12-345678901-2" className="font-mono" {...form.register("philhealthPin")} />,
              )}
              <div />
              {field("cityMunicipality", "City / municipality", <Input id="cityMunicipality" {...form.register("cityMunicipality")} />)}
              {field("barangay", "Barangay", <Input id="barangay" {...form.register("barangay")} />)}
              {field("province", "Province", <Input id="province" {...form.register("province")} />)}
            </CardContent>
          </Card>
        </fieldset>
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {candidates === null ? (
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              <UserPlusIcon /> {pending ? "Registering…" : "Register patient"}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/patients">Cancel</Link>
            </Button>
          </div>
        ) : null}
      </form>

      {candidates !== null ? (
        <section aria-labelledby="dup-heading" className="flex flex-col gap-3 self-start rounded-lg border border-warning/50 bg-card p-4">
          <h2 id="dup-heading" className="flex items-center gap-2 text-section font-semibold">
            <AlertTriangleIcon className="size-5 text-warning" aria-hidden />
            Possible existing records
          </h2>
          <p className="text-body text-muted-foreground">
            This person may already be registered. Open each record to compare. Registering a duplicate splits the patient&apos;s history.
          </p>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li key={c.patient.id} className="rounded-md border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.patient.displayName}</span>
                  <span className="font-mono text-table text-muted-foreground">{c.patient.patientNumber}</span>
                  <Badge variant={c.level === "certain" ? "critical" : c.level === "high" ? "danger" : "warning"}>{label(c.level)} match</Badge>
                  <Link
                    href={`/patients/${c.patient.id}`}
                    target="_blank"
                    className="ml-auto inline-flex items-center gap-1 text-table text-primary hover:underline"
                  >
                    Open record <ExternalLinkIcon className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <p className="text-table text-muted-foreground">
                  {clinicalDate(c.patient.birthDate)} · {sexLabel(c.patient.sex)} · {c.patient.primaryMobileMasked ?? "no mobile"} ·{" "}
                  {c.reasons.map((r) => REASONS[r] ?? label(r)).join("; ")}
                  {c.patient.resolvedFrom ? ` · matched through ${c.patient.resolvedFrom.patientNumber}, which was merged into this record` : ""}
                </p>
                {c.level !== "certain" ? (
                  <label className="mt-1.5 flex items-center gap-2 text-table">
                    <Checkbox
                      checked={reviewed.has(c.patient.id)}
                      onCheckedChange={(v) =>
                        setReviewed((s) => {
                          const n = new Set(s);
                          if (v) n.add(c.patient.id);
                          else n.delete(c.patient.id);
                          return n;
                        })
                      }
                    />
                    I checked this record and it is a different person
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-meta text-muted-foreground">
            If you find the same person registered twice, don&apos;t register a third record: tell a records officer, who can merge the duplicates from the
            patient record (Merge duplicate…). Registration never merges records by itself.
          </p>
          {hasCertain ? (
            <p className="text-table font-medium text-critical">A record with the same identifier exists. Use that record instead of registering a new one.</p>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="override-reason">Why is this a different person? *</Label>
              <Textarea
                id="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Twins; confirmed different mother's name"
              />
              <p className="text-meta text-muted-foreground">Recorded in the audit trail with the records you reviewed.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!hasCertain ? (
              <Button
                disabled={pending || !allReviewed || reason.trim().length < 5}
                onClick={() =>
                  form.handleSubmit((values) => submit(values, { reviewedCandidateIds: candidates.map((c) => c.patient.id), reason: reason.trim() }))()
                }
              >
                {pending ? "Registering…" : "Register as a new patient"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                setCandidates(null);
                setReason("");
              }}
            >
              Edit details
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
