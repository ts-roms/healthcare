"use client";

import { useActionState } from "react";
import { Button, Input, Label, NativeSelect, PasswordInput } from "@healthcare/ui/primitives";
import { signInDevice, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(signInDevice, {});
  return (
    <form action={action} className="flex flex-col gap-4" autoComplete="off">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Kiosk account email</Label>
        <Input id="email" name="email" type="email" required defaultValue={state.email} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <PasswordInput id="password" name="password" required autoComplete="off" />
      </div>
      {state.organizations && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="organizationId">Organization</Label>
          <NativeSelect id="organizationId" name="organizationId" required placeholder="Choose…">
            {state.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in this kiosk"}
      </Button>
    </form>
  );
}
