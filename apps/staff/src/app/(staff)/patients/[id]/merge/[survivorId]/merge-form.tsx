"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, GitMergeIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { MergeDifference } from "@/lib/api/types";
import { checkMergeForm, differenceLabel, type MergeFormErrors } from "@/lib/patient-merge";
import { mergePatient } from "../../merge-actions";

/**
 * The merge itself: tick every flagged difference as reviewed, give a reason and type the retired patient number.
 * The API checks everything again (versions, differences, blockers) and audits the merge.
 */
export function MergeForm(props: {
  retiredPatientId: string;
  retiredNumber: string;
  survivorPatientId: string;
  survivorNumber: string;
  retiredVersion: number;
  survivorVersion: number;
  differences: MergeDifference[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [acknowledged, setAcknowledged] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [errors, setErrors] = React.useState<MergeFormErrors>({});
  const [message, setMessage] = React.useState<string | null>(null);

  const toggle = (code: string, on: boolean) => setAcknowledged((current) => (on ? [...new Set([...current, code])] : current.filter((c) => c !== code)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const problems = checkMergeForm({ reason, confirmation, acknowledged }, props.retiredNumber, props.differences);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    start(async () => {
      const result = await mergePatient({
        retiredPatientId: props.retiredPatientId,
        retiredNumber: props.retiredNumber,
        survivorPatientId: props.survivorPatientId,
        retiredVersion: props.retiredVersion,
        survivorVersion: props.survivorVersion,
        differences: props.differences.map((d) => d.code),
        acknowledged,
        reason,
        confirmation,
      });
      if (result.ok) {
        toast.success(`${props.retiredNumber} merged into ${props.survivorNumber}`);
        router.push(`/patients/${result.data.survivorPatientId}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message);
      // Work appeared, or someone changed a record: show the fresh comparison.
      if (result.code === "merge_blocked" || result.code === "version_conflict" || result.code === "differences_not_acknowledged") router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <GitMergeIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Merge</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          {props.differences.length ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 flex items-center gap-1.5 text-body font-medium">
                <AlertTriangleIcon className="size-4 text-warning-foreground" aria-hidden /> These differ — confirm each one before merging
              </legend>
              {props.differences.map((d) => (
                <div key={d.code} className="flex items-start gap-2 text-body">
                  <Checkbox
                    id={`ack-${d.code}`}
                    checked={acknowledged.includes(d.code)}
                    onCheckedChange={(v) => toggle(d.code, v === true)}
                    aria-describedby={`ack-${d.code}-detail`}
                  />
                  <Label htmlFor={`ack-${d.code}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{differenceLabel(d)}</span>
                    <span id={`ack-${d.code}-detail`} className="text-table text-muted-foreground">
                      {props.retiredNumber}: {d.retired ?? "—"} · {props.survivorNumber}: {d.survivor ?? "—"} — I checked this is the same person.
                    </span>
                  </Label>
                </div>
              ))}
              {errors.acknowledged ? <p className="text-table text-danger-foreground">{errors.acknowledged}</p> : null}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="merge-reason">Reason *</Label>
            <Textarea
              id="merge-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Same person registered twice (PhilSys ID and birth certificate checked)"
              aria-invalid={Boolean(errors.reason)}
            />
            {errors.reason ? <p className="text-table text-danger-foreground">{errors.reason}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="merge-confirm">
              Type <span className="font-mono">{props.retiredNumber}</span> to confirm the record to retire *
            </Label>
            <Input
              id="merge-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              className="w-48 font-mono"
              aria-invalid={Boolean(errors.confirmation)}
            />
            {errors.confirmation ? <p className="text-table text-danger-foreground">{errors.confirmation}</p> : null}
          </div>
          {message ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-danger-foreground">
              {message}
            </p>
          ) : null}
          <p className="text-table text-muted-foreground">
            Nothing filed under {props.retiredNumber} is moved or changed. It becomes read only and every screen of {props.survivorNumber} shows its records,
            marked with its number. The merge can be undone from the surviving record.
          </p>
          <Button type="submit" disabled={pending} className="self-start">
            <GitMergeIcon aria-hidden /> Merge {props.retiredNumber} into {props.survivorNumber}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
