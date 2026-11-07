"use client";

import { formatTime } from "@/lib/format";
import type { IssuedTicket, KioskAppointment } from "@/lib/flow";
import { BigButton } from "../bits";
import { Frame, Notice } from "../frame";
import { useCheckIn } from "../use-check-in";
import { Greeting } from "./greeting";

const WAIT_TEXT: Record<Exclude<KioskAppointment["checkIn"], "open" | "done">, string> = {
  too_early: "Check-in opens closer to your appointment time. Please come back later, or see the front desk.",
  too_late: "The check-in time for this appointment has passed. Please see the front desk.",
};

/**
 * AppointmentCheckInPage: today's appointments of the person the server recognised — and only theirs, because the API
 * returns only the identified patient's. Whether check-in is open, early, late or done is the API's answer.
 */
export function AppointmentCheckInPage({
  facilityName,
  timeZone,
  patient,
  appointments,
  onTicket,
  onSessionOver,
  onOtherServices,
  hasServices,
  onBack,
  onStartOver,
}: {
  facilityName: string;
  timeZone: string;
  patient: { maskedName: string; birthYear: number };
  appointments: KioskAppointment[];
  onTicket: (ticket: IssuedTicket) => void;
  onSessionOver: () => void;
  onOtherServices: () => void;
  hasServices: boolean;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const { run, busyId, error } = useCheckIn(onTicket, onSessionOver);
  return (
    <Frame title="Your appointments today" facilityName={facilityName} onBack={onBack} onStartOver={onStartOver}>
      <Greeting patient={patient} onNotMe={onStartOver} />
      <ul className="flex flex-col gap-4">
        {appointments.map((a) => (
          <li key={a.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-6">
            <p className="text-3xl font-semibold">{formatTime(a.startsAt, timeZone)}</p>
            <p className="text-2xl">{a.service}</p>
            <p className="text-xl text-muted-foreground">with {a.practitioner}</p>
            {a.checkIn === "open" || a.checkIn === "done" ? (
              <BigButton
                onClick={() => run({ appointmentId: a.id }, a.service)}
                disabled={busyId !== null}
                className="self-start"
                variant={a.checkIn === "open" ? "default" : "outline"}
              >
                {busyId === a.id ? "One moment…" : a.checkIn === "open" ? "Check in" : "Show my ticket again"}
              </BigButton>
            ) : (
              <Notice tone="info">{WAIT_TEXT[a.checkIn]}</Notice>
            )}
          </li>
        ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
      {hasServices && (
        <BigButton variant="secondary" onClick={onOtherServices} className="self-start">
          I am here for something else
        </BigButton>
      )}
    </Frame>
  );
}
