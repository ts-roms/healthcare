"use client";

import * as React from "react";
import { MailCheckIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { askForResetLink } from "../password-reset-actions";

/** Asks for a reset link. What the person reads afterwards never says whether the email belongs to an account. */
export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          <MailCheckIcon className="size-5 text-success-foreground" aria-hidden /> Check your email
        </p>
        <p className="text-body text-muted-foreground">
          If <strong>{email}</strong> is the email of a staff account, we have sent a link. It works once and expires in 30 minutes. With two-step verification
          on, you will also need a code from your authenticator app.
        </p>
        <p className="text-meta text-muted-foreground">Nothing arrived? Check your spam folder, or ask your administrator for a temporary password.</p>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await askForResetLink(email);
          if (result.ok) setSent(true);
          else setError(result.message);
        });
      }}
    >
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="reset-email">Email</Label>
        <Input id="reset-email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send me a link"}
      </Button>
    </form>
  );
}
