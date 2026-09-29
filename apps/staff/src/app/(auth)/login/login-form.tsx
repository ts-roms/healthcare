"use client";

import * as React from "react";
import { AlertTriangleIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect } from "@healthcare/ui/primitives";
import { authenticate, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = React.useActionState(authenticate, { step: "password" } as LoginState);
  const error = state.error;

  return (
    <div className="flex flex-col gap-4">
      {notice && !error ? <p className="rounded-md border border-info/30 bg-info-subtle px-3 py-2 text-table text-info-foreground">{notice}</p> : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {state.step === "mfa" ? (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="mfa" />
          <input type="hidden" name="next" value={next} />
          <div className="flex items-center gap-2 text-body">
            <ShieldCheckIcon className="size-4 text-primary" aria-hidden />
            Enter the 6-digit code from your authenticator app.
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              className="h-10 font-mono tracking-[0.3em]"
            />
          </div>
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending ? "Verifying…" : "Verify and sign in"}
          </Button>
        </form>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="password" />
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} autoFocus className="h-10" />
          </div>
          {state.step === "organization" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="organizationId">Organization</Label>
              <NativeSelect id="organizationId" name="organizationId" required defaultValue="">
                <option value="" disabled>
                  Choose where you are working…
                </option>
                {state.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-meta text-muted-foreground">You belong to more than one organization. Choose one and enter your password again.</p>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
          </div>
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            <KeyRoundIcon /> {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
