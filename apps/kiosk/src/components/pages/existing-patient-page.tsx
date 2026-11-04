"use client";

import { useState } from "react";
import { identifyPatient } from "@/app/actions";
import { safely } from "@/lib/safe-action";
import { birthDateProblem, EMPTY_BIRTH_DATE, toIsoDate } from "@/lib/birth-date";
import type { KioskAppointment } from "@/lib/flow";
import { BigButton, BigInput, DateField, Field } from "../bits";
import { Frame, Notice } from "../frame";

export type Identified = { patient: { maskedName: string; birthYear: number }; appointments: KioskAppointment[] };

/**
 * ExistingPatientPage: three things must match — patient or mobile number, date of birth and first name. The screen never
 * says which one was wrong, and shows only initials afterwards (the API returns nothing more).
 */
export function ExistingPatientPage({
  facilityName,
  today,
  onIdentified,
  onLocked,
  onBack,
  onStartOver,
}: {
  facilityName: string;
  today: string;
  onIdentified: (found: Identified) => void;
  onLocked: () => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const [key, setKey] = useState("");
  const [givenName, setGivenName] = useState("");
  const [birth, setBirth] = useState(EMPTY_BIRTH_DATE);
  const [errors, setErrors] = useState<{ key?: string; givenName?: string; birth?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = {
      key: key.trim().length < 3 ? "Please enter your patient number or mobile number" : undefined,
      givenName: givenName.trim() ? undefined : "Please enter your first name",
      birth: birthDateProblem(birth, today) ?? undefined,
    };
    setErrors(next);
    setMessage(null);
    const birthDate = toIsoDate(birth, today);
    if (next.key || next.givenName || next.birth || !birthDate) return;

    setBusy(true);
    const result = await safely(() => identifyPatient({ key: key.trim(), birthDate, givenName: givenName.trim() }));
    setBusy(false);
    if (result.ok) return onIdentified(result.data);
    if (result.code === "kiosk_session_locked" || result.code === "kiosk_cooling_down" || result.code === "kiosk_session_expired") return onLocked();
    setMessage(result.message);
  }

  return (
    <Frame title="Let's find your record" facilityName={facilityName} onBack={onBack} onStartOver={onStartOver}>
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate autoComplete="off">
        <Field
          id="key"
          label="Patient number or mobile number"
          hint="Your patient number is on your clinic card. It starts with the letter P."
          error={errors.key}
        >
          <BigInput
            id="key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={Boolean(errors.key)}
            aria-describedby={errors.key ? "key-error" : "key-hint"}
          />
        </Field>
        <DateField idPrefix="birth" label="Your date of birth" value={birth} onChange={setBirth} error={errors.birth} />
        <Field id="givenName" label="Your first name" error={errors.givenName}>
          <BigInput id="givenName" value={givenName} onChange={(e) => setGivenName(e.target.value)} aria-invalid={Boolean(errors.givenName)} />
        </Field>
        {message && <Notice tone="error">{message}</Notice>}
        <BigButton type="submit" disabled={busy} className="self-start">
          {busy ? "Checking…" : "Continue"}
        </BigButton>
      </form>
    </Frame>
  );
}
