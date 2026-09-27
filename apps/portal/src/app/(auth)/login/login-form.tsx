"use client";

import * as React from "react";
import { Button } from "@healthcare/ui/primitives";
import { type AuthFormState, signIn } from "../actions";
import { Field, FormError } from "../form-parts";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = React.useActionState(signIn, {} as AuthFormState);
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {notice && !state.error ? <p className="rounded-lg border border-info/30 bg-info-subtle p-3 text-body text-info-foreground">{notice}</p> : null}
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
      <Field name="password" label="Password" type="password" autoComplete="current-password" required error={state.fieldErrors?.password} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-meta text-muted-foreground">Forgot your password? Ask the clinic for a new activation code.</p>
    </form>
  );
}
