"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@healthcare/ui/primitives";
import { type AuthFormState, resetPassword } from "../actions";
import { Field, FormError } from "../form-parts";

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const tokenInAddress = () => new URLSearchParams(window.location.hash.slice(1)).get("token");
/** Nothing is known on the server: the emailed link keeps its token after the "#", which never reaches a server. */
const tokenOnServer = () => undefined;

/**
 * The emailed link carries its token after the "#", which browsers never send to a server or in Referer headers, so it
 * is read here in the browser only.
 */
export function ResetPasswordForm() {
  const [state, action, pending] = React.useActionState(resetPassword, {} as AuthFormState);
  const token = React.useSyncExternalStore(subscribeToHash, tokenInAddress, tokenOnServer);

  if (token === undefined) return null;
  if (!token) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <p className="font-semibold">This link is incomplete</p>
        <p className="text-body text-muted-foreground">Open the link in your email again, or ask for a new one.</p>
        <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
          Ask for a new link
        </Link>
      </div>
    );
  }
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormError message={state.error} />
      <Field name="birthDate" label="Date of birth" type="date" required autoFocus defaultValue={state.values?.birthDate} error={e.birthDate ?? e.token} />
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
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
      <Link href="/forgot-password" className="text-center text-body font-medium text-primary underline-offset-4 hover:underline">
        The link expired? Ask for a new one
      </Link>
    </form>
  );
}
