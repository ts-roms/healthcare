"use client";

import * as React from "react";
import { MailCheckIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { type AuthFormState, requestReset } from "../actions";
import { Field, FormError } from "../form-parts";

/** Asks for a reset link. What the patient reads afterwards never says whether the email belongs to an account. */
export function ForgotPasswordForm() {
  const [state, action, pending] = React.useActionState(requestReset, {} as AuthFormState);
  if (state.requested) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          <MailCheckIcon className="size-5 text-success-foreground" aria-hidden />
          Check your email
        </p>
        <p className="text-body text-muted-foreground">
          If {state.values?.email ? <strong>{state.values.email}</strong> : "that email"} is the email of a MyHealth account, we have sent a link. It works once
          and expires in 30 minutes. You will need your date of birth to use it.
        </p>
        <p className="text-meta text-muted-foreground">
          Nothing arrived? Check your spam folder, or wait a few minutes and ask again. You can also ask the clinic for help.
        </p>
      </div>
    );
  }
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <FormError message={state.error} />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        autoFocus
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send me a link"}
      </Button>
    </form>
  );
}
