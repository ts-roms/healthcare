"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, LogInIcon } from "lucide-react";
import { sexLabel } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { PatientSex } from "@/lib/api/types";
import { registerWalkIn } from "../actions";

type Option = { id: string; name: string };

export function WalkInForm({
  patient,
  visitTypes,
  practitioners,
}: {
  patient: { id: string; displayName: string; patientNumber: string; age: number; sex: PatientSex; status: string };
  visitTypes: Option[];
  practitioners: Option[];
}) {
  const router = useRouter();
  const [visitTypeId, setVisitTypeId] = React.useState(visitTypes.length === 1 ? (visitTypes[0]?.id ?? "") : "");
  const [priority, setPriority] = React.useState<"routine" | "urgent" | "emergency">("routine");
  const [chiefComplaint, setChiefComplaint] = React.useState("");
  const [practitionerId, setPractitionerId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // One key per attempt: a double click or a retried request adds the patient once.
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerWalkIn(
        {
          patientId: patient.id,
          visitTypeId,
          priority,
          chiefComplaint: chiefComplaint.trim() || undefined,
          assignedPractitionerId: practitionerId || undefined,
        },
        attemptKey,
      );
      if (result.ok) {
        toast.success(`Checked in — ticket ${result.data.ticket}`, { description: patient.displayName });
        router.push("/queue");
        return;
      }
      setAttemptKey(crypto.randomUUID());
      setError(result.message);
    });
  };

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{patient.displayName}</CardTitle>
        </CardHeader>
        <CardContent className="text-table text-muted-foreground">
          <span className="font-mono">{patient.patientNumber}</span> · {patient.age} y · {sexLabel(patient.sex)}
          {patient.status !== "active" ? (
            <p role="alert" className="mt-2 font-medium text-warning-foreground">
              This record is {patient.status}. Check the patient record before checking in.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="visitType">Visit type *</Label>
          <NativeSelect id="visitType" value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {visitTypes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </NativeSelect>
          {visitTypes.length === 0 ? <p className="text-meta text-danger-foreground">No in-person visit types are configured.</p> : null}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="priority">Priority</Label>
          <NativeSelect id="priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </NativeSelect>
          <p className="text-meta text-muted-foreground">Urgent and emergency patients are served first.</p>
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="complaint">Chief complaint</Label>
          <Textarea
            id="complaint"
            maxLength={500}
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            placeholder="In the patient's words"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="practitioner">Assign to</Label>
          <NativeSelect emptyText="No practitioners set up" id="practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
            <option value="">Next available</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !visitTypeId}>
          <LogInIcon /> {pending ? "Checking in…" : "Check in"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/patients/${patient.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
