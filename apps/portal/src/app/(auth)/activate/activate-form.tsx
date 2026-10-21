"use client";

import * as React from "react";
import { Button } from "@healthcare/ui/primitives";
import { activate, type AuthFormState, lookupCard } from "../actions";
import { Field, FormError } from "../form-parts";

export function ActivateForm() {
  const [state, action, pending] = React.useActionState(activate, {} as AuthFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  // The card's link carries its key after "#", which the browser never sends to a server; read it here, then clear it.
  const [card, setCard] = React.useState<{ patientNumber: string; givenName: string } | null>(null);
  const [cardFailed, setCardFailed] = React.useState(false);
  React.useEffect(() => {
    const key = window.location.hash.replace(/^#/, "");
    if (!key) return;
    window.history.replaceState(null, "", window.location.pathname);
    void lookupCard(key).then((found) => (found ? setCard(found) : setCardFailed(true)));
  }, []);
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <FormError message={state.error} />
      {card ? (
        <p role="status" className="rounded-lg border border-success/30 bg-success-subtle p-3 text-body">
          Hello, {card.givenName}. Your card is for patient number <span className="font-mono">{card.patientNumber}</span>. Enter your date of birth and the
          activation code the clinic gave you, then choose your own password.
        </p>
      ) : cardFailed ? (
        <p role="status" className="rounded-lg border p-3 text-body text-muted-foreground">
          This card could not be used here. Type your patient number below, or ask the clinic to invite you again.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">1. Confirm it&apos;s you</legend>
        <Field
          name="patientNumber"
          label="Patient number"
          hint="Printed on your clinic card or receipt."
          autoComplete="off"
          autoCapitalize="characters"
          required
          autoFocus={!card}
          key={card?.patientNumber ?? "typed"}
          readOnly={!!card}
          defaultValue={card?.patientNumber ?? v.patientNumber}
          error={e.patientNumber}
        />
        <Field name="birthDate" label="Date of birth" type="date" required defaultValue={v.birthDate} error={e.birthDate} />
        <Field
          name="activationCode"
          label="Activation code"
          hint="10 letters and numbers, e.g. ABCDE-23456. It expires 3 days after the clinic gives it to you."
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          defaultValue={v.activationCode}
          error={e.activationCode}
          className="h-11 font-mono text-section tracking-widest uppercase"
        />
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">2. Choose how you&apos;ll sign in</legend>
        <Field name="email" label="Email" type="email" inputMode="email" autoComplete="email" required defaultValue={v.email} error={e.email} />
        <Field
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters. A short phrase is easy to remember."
          required
          error={e.password}
        />
        <Field name="confirmPassword" label="Type the password again" type="password" autoComplete="new-password" required error={e.confirmPassword} />
      </fieldset>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Setting up…" : "Set up and sign in"}
      </Button>
    </form>
  );
}
