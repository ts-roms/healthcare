"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, RadioGroup, RadioGroupTile, Textarea } from "@healthcare/ui/primitives";
import { DayPicker, SlotPicker } from "@/components/booking-pickers";
import type { BookingRulesView, PortalAppointment } from "@/lib/api/types";
import { bookingDays, bookingMessage, lengthText, longDate, slotTime } from "@/lib/booking";
import { cancelAppointment, rescheduleAppointment } from "../actions";
import { usePickedSlot, useSlots } from "../use-slots";
import { WaitlistOffer } from "../waitlist-offer";

type Doctor = { id: string; displayName: string; specialty: string | null };

/** Move the visit to another open time — with the same doctor or another at the same clinic — or cancel it. */
export function ChangeAppointment({ visit, rules, practitioners }: { visit: PortalAppointment; rules: BookingRulesView; practitioners: Doctor[] }) {
  return (
    <div className="flex flex-col gap-6">
      {visit.canReschedule ? <Reschedule visit={visit} rules={rules} practitioners={practitioners} /> : null}
      {visit.canCancel ? <Cancel visit={visit} /> : null}
      <p className="text-meta text-muted-foreground">
        Online changes close {lengthText(rules.changeCutoffMinutes)} before the visit. After that, call the clinic.
      </p>
    </div>
  );
}

const SAME = "same";
const ANY = "any";

function Reschedule({ visit, rules, practitioners }: { visit: PortalAppointment; rules: BookingRulesView; practitioners: Doctor[] }) {
  const router = useRouter();
  const [days] = React.useState(() => bookingDays(new Date(), rules, visit.timeZone));
  const [date, setDate] = React.useState(days[0] ?? "");
  const [doctor, setDoctor] = React.useState<string>(SAME);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const chosenDoctor = doctor === SAME ? visit.practitionerId : doctor === ANY ? undefined : doctor;
  const others = practitioners.filter((p) => p.id !== visit.practitionerId);
  const { key, slots, loading, reload } = useSlots({
    facilityId: visit.facilityId,
    visitTypeId: visit.visitTypeId,
    practitionerId: chosenDoctor,
    date,
  });
  const [slot, setSlot] = usePickedSlot(key);

  const move = () => {
    if (!slot) return;
    setError(null);
    startTransition(async () => {
      // Another doctor is named only when the time chosen is with one.
      const result = await rescheduleAppointment(
        visit.id,
        slot.startsAt,
        visit.version,
        slot.practitionerId === visit.practitionerId ? undefined : slot.practitionerId,
      );
      if (result.ok) {
        router.push(`/appointments?moved=${visit.id}`);
        return;
      }
      setError(bookingMessage(result.code, result.message));
      if (result.code === "slot_unavailable") {
        setSlot(null);
        reload();
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-section-lg font-semibold">Choose a new time</h2>
      {others.length > 0 ? (
        <RadioGroup aria-label="Doctor" value={doctor} onValueChange={setDoctor} className="flex flex-wrap gap-2">
          <Pill value={SAME}>{visit.practitionerName}</Pill>
          <Pill value={ANY}>Any doctor at this clinic</Pill>
          {others.map((p) => (
            <Pill key={p.id} value={p.id}>
              {p.displayName}
              {p.specialty ? <span className="text-muted-foreground"> · {p.specialty}</span> : null}
            </Pill>
          ))}
        </RadioGroup>
      ) : (
        <p className="text-body text-muted-foreground">With {visit.practitionerName}.</p>
      )}
      <DayPicker days={days} value={date} onChange={setDate} />
      <p className="text-meta font-medium">{longDate(date)}</p>
      <SlotPicker slots={slots} timeZone={visit.timeZone} loading={loading} value={slot} onChange={setSlot} showPractitioner={doctor === ANY} />
      {rules.waitlistEnabled && !loading && slots !== null && slots.length === 0 ? (
        <WaitlistOffer
          facilityId={visit.facilityId}
          visitTypeId={visit.visitTypeId}
          practitionerId={chosenDoctor}
          date={date}
          maxEntries={rules.maxWaitlistEntries}
        />
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-body text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" size="lg" onClick={move} disabled={!slot || pending}>
        {pending ? "Moving…" : slot ? `Move to ${slotTime(slot.startsAt, visit.timeZone)}, ${longDate(date)}` : "Choose a time"}
      </Button>
    </section>
  );
}

function Pill({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadioGroupTile value={value} className="rounded-full px-4 py-2 text-body">
      {children}
    </RadioGroupTile>
  );
}

function Cancel({ visit }: { visit: PortalAppointment }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const cancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelAppointment(visit.id, visit.version, reason.trim().length >= 3 ? reason : undefined);
      if (result.ok) {
        router.push(`/appointments?cancelled=${visit.id}`);
        return;
      }
      setError(bookingMessage(result.code, result.message));
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-section-lg font-semibold">Cancel this visit</h2>
      {confirming ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-reason">Why are you cancelling? (optional)</Label>
            <Textarea id="cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-body text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={cancel} disabled={pending}>
              {pending ? "Cancelling…" : "Yes, cancel the visit"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Keep the visit
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body text-muted-foreground">The time is released for other patients.</p>
          <Button type="button" variant="outline" onClick={() => setConfirming(true)} className="self-start">
            Cancel visit
          </Button>
        </>
      )}
    </section>
  );
}
