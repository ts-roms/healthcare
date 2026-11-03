"use client";

import { BigButton } from "../bits";

/**
 * Who the kiosk thinks is here: initials and birth year only (what the API returns), with a one-touch way out for the
 * wrong person. The kiosk never shows a full name, number or address.
 */
export function Greeting({ patient, onNotMe }: { patient: { maskedName: string; birthYear: number }; onNotMe: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary-subtle px-6 py-4">
      <p className="text-2xl">
        Hello, <span className="font-semibold">{patient.maskedName}</span> <span className="text-muted-foreground">(born {patient.birthYear})</span>
      </p>
      <BigButton variant="outline" onClick={onNotMe} className="min-h-14 px-6 text-xl">
        This is not me
      </BigButton>
    </div>
  );
}
