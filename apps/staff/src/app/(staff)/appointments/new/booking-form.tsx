"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CalendarPlusIcon } from "lucide-react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { bookAppointment } from "../actions";

type Option = { id: string; name: string };
type Selection = { practitionerId: string; visitTypeId: string; date: string };

export function BookingForm({
  facilityId,
  today,
  patient,
  practitioners,
  visitTypes,
  selection,
  slots,
  availabilityError,
}: {
  facilityId: string;
  today: string;
  patient: { id: string; displayName: string; patientNumber: string; status: string };
  practitioners: Option[];
  visitTypes: Option[];
  selection: Selection;
  slots: Array<{ startsAt: string; endsAt: string }> | null;
  availabilityError: string | null;
}) {
  const router = useRouter();
  const [startsAt, setStartsAt] = React.useState<string | null>(null);
  const [bookingChannel, setBookingChannel] = React.useState<"front_desk" | "phone">("front_desk");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());

  // Changing practitioner, visit type or day reloads the open slots on the server.
  const select = (change: Partial<Selection>) => {
    const next = { ...selection, ...change };
    setStartsAt(null);
    const query = new URLSearchParams({ patientId: patient.id, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) });
    router.replace(`/appointments/new?${query}`, { scroll: false });
  };

  const book = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startsAt) return;
    setError(null);
    startTransition(async () => {
      const result = await bookAppointment(
        {
          patientId: patient.id,
          practitionerId: selection.practitionerId,
          facilityId,
          visitTypeId: selection.visitTypeId,
          startsAt,
          bookingChannel,
          reason: reason.trim() || undefined,
        },
        attemptKey,
      );
      if (result.ok) {
        toast.success(`Booked ${patient.displayName}`, { description: `${selection.date} at ${clinicalTime(startsAt)}` });
        router.push(`/appointments?date=${selection.date}&practitionerId=${selection.practitionerId}`);
        return;
      }
      setAttemptKey(crypto.randomUUID());
      setError(result.message);
      // The slot may have been taken: reload what is still open.
      setStartsAt(null);
      router.refresh();
    });
  };

  return (
    <form onSubmit={book} className="flex max-w-3xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{patient.displayName}</CardTitle>
          <span className="font-mono text-table text-muted-foreground">{patient.patientNumber}</span>
        </CardHeader>
        {patient.status !== "active" ? (
          <CardContent>
            <p role="alert" className="text-table font-medium text-warning-foreground">
              This record is {patient.status}. Check the patient record before booking.
            </p>
          </CardContent>
        ) : null}
      </Card>

      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="practitioner">Practitioner *</Label>
          <NativeSelect id="practitioner" value={selection.practitionerId} onChange={(e) => select({ practitionerId: e.target.value })}>
            <option value="" disabled>
              Select…
            </option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="visitType">Visit type *</Label>
          <NativeSelect id="visitType" value={selection.visitTypeId} onChange={(e) => select({ visitTypeId: e.target.value })}>
            <option value="" disabled>
              Select…
            </option>
            {visitTypes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="date">Day *</Label>
          <Input id="date" type="date" min={today} value={selection.date} onChange={(e) => e.target.value && select({ date: e.target.value })} />
        </div>
      </fieldset>

      <section aria-labelledby="slots-heading" className="flex flex-col gap-2">
        <h2 id="slots-heading" className="text-section font-semibold">
          Open slots
        </h2>
        {!selection.practitionerId || !selection.visitTypeId ? (
          <p className="text-body text-muted-foreground">Choose a practitioner and visit type to see open slots.</p>
        ) : availabilityError ? (
          <p role="alert" className="text-body text-danger-foreground">
            {availabilityError}
          </p>
        ) : slots && slots.length > 0 ? (
          <div role="radiogroup" aria-label="Open slots" className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={startsAt === s.startsAt}
                onClick={() => setStartsAt(s.startsAt)}
                className={cn(
                  "tabular rounded-md border px-2.5 py-1 text-table outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/50",
                  startsAt === s.startsAt ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                )}
              >
                {clinicalTime(s.startsAt)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-body text-muted-foreground">No open slots on this day. Try another day or practitioner.</p>
        )}
      </section>

      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="grid gap-1">
          <Label htmlFor="channel">Booked via</Label>
          <NativeSelect id="channel" value={bookingChannel} onChange={(e) => setBookingChannel(e.target.value as typeof bookingChannel)}>
            <option value="front_desk">Front desk</option>
            <option value="phone">Phone</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="reason">Reason for visit</Label>
          <Input id="reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Follow-up of blood pressure" />
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !startsAt}>
          <CalendarPlusIcon /> {pending ? "Booking…" : startsAt ? `Book ${clinicalTime(startsAt)}` : "Book"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/patients/${patient.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
