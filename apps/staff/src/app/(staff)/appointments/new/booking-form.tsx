"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CalendarPlusIcon } from "lucide-react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, RadioGroup, RadioGroupTile, toast } from "@healthcare/ui/primitives";
import { updateCareActivity } from "../../clinic/care-plans/actions";
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
  context,
}: {
  facilityId: string;
  today: string;
  patient: { id: string; displayName: string; patientNumber: string; status: string };
  practitioners: Option[];
  visitTypes: Option[];
  selection: Selection;
  slots: Array<{ startsAt: string; endsAt: string }> | null;
  availabilityError: string | null;
  /** Booking started elsewhere: return there afterwards, and link a care-plan follow-up activity. */
  context: { returnTo: string; activity: { carePlanId: string; activityId: string } | null; reason: string };
}) {
  const router = useRouter();
  const [startsAt, setStartsAt] = React.useState<string | null>(null);
  const [bookingChannel, setBookingChannel] = React.useState<"front_desk" | "phone">("front_desk");
  const [reason, setReason] = React.useState(context.reason);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());

  // Changing practitioner, visit type or day reloads the open slots on the server.
  const select = (change: Partial<Selection>) => {
    const next = { ...selection, ...change };
    setStartsAt(null);
    const carried = {
      returnTo: context.returnTo,
      carePlanId: context.activity?.carePlanId ?? "",
      activityId: context.activity?.activityId ?? "",
      reason: context.reason,
    };
    const query = new URLSearchParams({ patientId: patient.id, ...Object.fromEntries(Object.entries({ ...next, ...carried }).filter(([, v]) => v)) });
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
        const appointment = result.data[0];
        if (context.activity && appointment) {
          // The care-plan follow-up now has its appointment; it becomes "scheduled".
          const linked = await updateCareActivity({ ...context.activity, status: "scheduled", appointmentId: appointment.id });
          if (!linked.ok) toast.warning("Booked, but the care-plan follow-up could not be linked", { description: linked.message });
        }
        router.push(context.returnTo || `/appointments?date=${selection.date}&practitionerId=${selection.practitionerId}`);
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

      {context.activity ? (
        <p className="rounded-md border border-info/40 bg-info-subtle px-3 py-2 text-table">
          This booking completes a care-plan follow-up: the appointment is linked to it and the activity becomes scheduled.
        </p>
      ) : null}
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
          <RadioGroup aria-label="Open slots" value={startsAt} onValueChange={setStartsAt} className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <RadioGroupTile
                key={s.startsAt}
                value={s.startsAt}
                className="tabular px-2.5 py-1 text-table data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
              >
                {clinicalTime(s.startsAt)}
              </RadioGroupTile>
            ))}
          </RadioGroup>
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
          <Link href={context.returnTo || `/patients/${patient.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
