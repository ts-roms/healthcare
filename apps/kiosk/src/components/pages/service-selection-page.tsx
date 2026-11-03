"use client";

import type { IssuedTicket, KioskService } from "@/lib/flow";
import { BigButton } from "../bits";
import { Frame, Notice } from "../frame";
import { useCheckIn } from "../use-check-in";
import { Greeting } from "./greeting";

/** ServiceSelectionPage: the walk-in services the clinic switched on for kiosks. Nothing here is a clinical decision. */
export function ServiceSelectionPage({
  facilityName,
  patient,
  services,
  onTicket,
  onSessionOver,
  onBack,
  onStartOver,
}: {
  facilityName: string;
  patient: { maskedName: string; birthYear: number };
  services: KioskService[];
  onTicket: (ticket: IssuedTicket) => void;
  onSessionOver: () => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const { run, busyId, error } = useCheckIn(onTicket, onSessionOver);
  return (
    <Frame title="What are you here for?" facilityName={facilityName} onBack={onBack} onStartOver={onStartOver}>
      <Greeting patient={patient} onNotMe={onStartOver} />
      {services.length === 0 ? (
        <Notice tone="info">No services are open at this kiosk. Please see the front desk.</Notice>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <li key={s.id}>
              <BigButton
                variant="outline"
                disabled={busyId !== null}
                onClick={() => run({ visitTypeId: s.id }, s.name)}
                className="min-h-28 w-full text-3xl whitespace-normal"
              >
                {busyId === s.id ? "One moment…" : s.name}
              </BigButton>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-xl text-muted-foreground">If you are not sure which to choose, please ask the front desk.</p>
    </Frame>
  );
}
