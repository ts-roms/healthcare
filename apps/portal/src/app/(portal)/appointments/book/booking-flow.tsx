"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheckIcon, MapPinIcon, StethoscopeIcon, VideoIcon } from "lucide-react";
import { Button, Label, RadioGroup, RadioGroupTile, Textarea } from "@healthcare/ui/primitives";
import { DayPicker, SlotPicker } from "@/components/booking-pickers";
import type { BookingOptions } from "@/lib/api/types";
import { bookingDays, bookingMessage, lengthText, longDate, rulesFor, slotTime } from "@/lib/booking";
import { usePickedSlot, useSlots } from "../use-slots";
import { bookAppointment } from "../actions";
import { WaitlistOffer } from "../waitlist-offer";

const ANY = "";
/** The "any doctor" choice; a radio value cannot be empty. */
const ANY_CHOICE = "any";

/** Choose what, where, who and when, then confirm. The API re-checks every rule when booking. */
export function BookingFlow({ options }: { options: BookingOptions }) {
  const router = useRouter();
  const [visitTypeId, setVisitTypeId] = React.useState(options.visitTypes.length === 1 ? (options.visitTypes[0]?.id ?? "") : "");
  const [facilityId, setFacilityId] = React.useState(options.facilities.length === 1 ? (options.facilities[0]?.id ?? "") : "");
  const [practitionerId, setPractitionerId] = React.useState(ANY);
  const site = options.facilities.find((f) => f.id === facilityId);
  const timeZone = site?.timeZone ?? "Asia/Manila";
  const [now] = React.useState(() => new Date());
  const rules = rulesFor(options, facilityId);
  const days = bookingDays(now, rules, timeZone);
  const [date, setDate] = React.useState(days[0] ?? "");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const ready = Boolean(visitTypeId && facilityId && date);
  const { key, slots, loading, reload } = useSlots(ready ? { facilityId, visitTypeId, date, practitionerId: practitionerId || undefined } : null);
  const [slot, setSlot] = usePickedSlot(key);

  const type = options.visitTypes.find((t) => t.id === visitTypeId);

  const book = () => {
    if (!slot) return;
    setError(null);
    startTransition(async () => {
      const result = await bookAppointment({ facilityId, visitTypeId, practitionerId: slot.practitionerId, startsAt: slot.startsAt, reason });
      if (result.ok) {
        router.push(`/appointments?booked=${result.data.id}`);
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
    <div className="flex flex-col gap-6">
      <Step title="What kind of visit?">
        <RadioGroup aria-label="Kind of visit" value={visitTypeId} onValueChange={setVisitTypeId} className="flex flex-col gap-2">
          {options.visitTypes.map((t) => (
            <Choice key={t.id} value={t.id}>
              <span className="flex items-center gap-2 font-semibold">
                {t.modality === "telemedicine" ? <VideoIcon className="size-4" aria-hidden /> : <StethoscopeIcon className="size-4" aria-hidden />}
                {t.name}
              </span>
              <span className="text-meta text-muted-foreground">
                {t.modality === "telemedicine" ? "Online, by video" : "At the clinic"} · about {t.durationMinutes} minutes
              </span>
            </Choice>
          ))}
        </RadioGroup>
        {type?.modality === "telemedicine" ? (
          <p className="text-meta text-muted-foreground">
            Not every concern can be handled online. Your doctor may ask you to come to the clinic. Before the call you will answer a few questions.
          </p>
        ) : null}
      </Step>

      {options.facilities.length > 1 ? (
        <Step title="Where?">
          <RadioGroup
            aria-label="Clinic"
            value={facilityId}
            onValueChange={(id) => {
              setFacilityId(id);
              setPractitionerId(ANY);
            }}
            className="flex flex-col gap-2"
          >
            {options.facilities.map((f) => (
              <Choice key={f.id} value={f.id}>
                <span className="flex items-center gap-2 font-semibold">
                  <MapPinIcon className="size-4" aria-hidden /> {f.name}
                </span>
                {f.cityMunicipality ? <span className="text-meta text-muted-foreground">{f.cityMunicipality}</span> : null}
              </Choice>
            ))}
          </RadioGroup>
        </Step>
      ) : null}

      {site ? (
        <Step title="Which doctor?">
          <RadioGroup
            aria-label="Doctor"
            value={practitionerId === ANY ? ANY_CHOICE : practitionerId}
            onValueChange={(id) => setPractitionerId(id === ANY_CHOICE ? ANY : id)}
            className="flex flex-wrap gap-2"
          >
            <Pill value={ANY_CHOICE}>Any available doctor</Pill>
            {site.practitioners.map((p) => (
              <Pill key={p.id} value={p.id}>
                {p.displayName}
                {p.specialty ? <span className="text-muted-foreground"> · {p.specialty}</span> : null}
              </Pill>
            ))}
          </RadioGroup>
        </Step>
      ) : null}

      {ready ? (
        <Step title="When?">
          <DayPicker days={days} value={date} onChange={setDate} />
          <p className="text-meta font-medium">{longDate(date)}</p>
          <p className="text-meta text-muted-foreground">
            This clinic takes online bookings at least {lengthText(rules.minLeadMinutes)} ahead, up to {rules.maxAdvanceDays} days.
          </p>
          <SlotPicker slots={slots} timeZone={timeZone} loading={loading} value={slot} onChange={setSlot} showPractitioner={practitionerId === ANY} />
          {rules.waitlistEnabled && !loading && slots !== null && slots.length === 0 ? (
            <WaitlistOffer
              facilityId={facilityId}
              visitTypeId={visitTypeId}
              practitionerId={practitionerId || undefined}
              date={date}
              maxEntries={rules.maxWaitlistEntries}
            />
          ) : null}
        </Step>
      ) : null}

      {slot && type && site ? (
        <Step title="Confirm">
          <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
            <p className="flex items-center gap-2 font-semibold">
              <CalendarCheckIcon className="size-4 text-primary" aria-hidden />
              {longDate(date)}, {slotTime(slot.startsAt, timeZone)}
            </p>
            <p className="text-body">
              {type.name} with {slot.practitionerName}
            </p>
            <p className="text-meta text-muted-foreground">{type.modality === "telemedicine" ? "Online" : site.name}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Reason for the visit (optional)</Label>
            <Textarea id="reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. follow-up, check-up, cough" />
            <p className="text-meta text-muted-foreground">Only the clinic sees this. Do not use it for emergencies.</p>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-body text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" size="lg" onClick={book} disabled={pending}>
            {pending ? "Booking…" : "Book this time"}
          </Button>
          <p className="text-meta text-muted-foreground">
            You can change or cancel online until {lengthText(rules.changeCutoffMinutes)} before. We will send you a confirmation and a reminder.
          </p>
        </Step>
      ) : null}
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-section-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadioGroupTile value={value} className="flex flex-col items-start gap-0.5 rounded-xl p-4 data-[state=checked]:text-foreground">
      {children}
    </RadioGroupTile>
  );
}

function Pill({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadioGroupTile value={value} className="rounded-full px-4 py-2 text-body">
      {children}
    </RadioGroupTile>
  );
}
