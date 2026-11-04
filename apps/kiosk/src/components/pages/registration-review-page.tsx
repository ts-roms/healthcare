"use client";

import { useRef, useState } from "react";
import { submitRegistration } from "@/app/actions";
import { safely } from "@/lib/safe-action";
import { MONTHS } from "@/lib/birth-date";
import { RELATIONSHIPS, type RegistrationForm, SEXES, toRegistrationPayload } from "@/lib/registration";
import { BigButton, newKey } from "../bits";
import { Frame, Notice } from "../frame";

const label = <T extends { value: string; label: string }>(list: readonly T[], value: string | undefined) =>
  list.find((i) => i.value === value)?.label ?? value ?? "";

/**
 * RegistrationReviewPage: the person reads everything back before it is sent. Sending is a separate, deliberate touch,
 * and the same key is reused if they tap twice or the connection drops, so reception receives one registration.
 */
export function RegistrationReviewPage({
  facilityName,
  today,
  form,
  onSubmitted,
  onSessionOver,
  onEdit,
  onStartOver,
}: {
  facilityName: string;
  today: string;
  form: RegistrationForm;
  onSubmitted: (reference: string) => void;
  onSessionOver: () => void;
  onEdit: () => void;
  onStartOver: () => void;
}) {
  const key = useRef(newKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: Array<[string, string]> = [
    ["Name", [form.givenName, form.middleName, form.familyName].filter(Boolean).join(" ")],
    ["Date of birth", `${form.birthDay} ${MONTHS[Number(form.birthMonth) - 1] ?? ""} ${form.birthYear}`],
    ["Sex", label(SEXES, form.sex)],
    ["Mobile number", form.mobile],
    ...(form.email ? ([["Email", form.email]] as Array<[string, string]>) : []),
    ["Address", [form.line1, form.barangay, form.cityMunicipality, form.province, form.postalCode].filter(Boolean).join(", ")],
    ...(form.philhealthPin ? ([["PhilHealth number", form.philhealthPin]] as Array<[string, string]>) : []),
    ["Emergency contact", `${form.emergencyName}, ${form.emergencyNumber} (${label(RELATIONSHIPS, form.emergencyRelationship)})`],
  ];

  async function send() {
    setBusy(true);
    setError(null);
    const result = await safely(() => submitRegistration(toRegistrationPayload(form, today), key.current));
    setBusy(false);
    if (result.ok) return onSubmitted(result.data.reference);
    if (result.code === "kiosk_session_expired") return onSessionOver();
    setError(result.message);
  }

  return (
    <Frame title="Is everything correct?" facilityName={facilityName} onBack={onEdit} onStartOver={onStartOver}>
      <dl className="divide-y rounded-2xl border bg-card">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-1 px-6 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
            <dt className="text-xl text-muted-foreground">{term}</dt>
            <dd className="text-2xl font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-4">
        <BigButton onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Yes, send to reception"}
        </BigButton>
        <BigButton variant="outline" onClick={onEdit} disabled={busy}>
          No, let me change something
        </BigButton>
      </div>
    </Frame>
  );
}
