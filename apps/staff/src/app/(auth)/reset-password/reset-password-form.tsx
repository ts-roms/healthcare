"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { chooseNewPassword } from "../password-reset-actions";

/** The token is in the link's fragment (#token=…), which browsers never send to a server; it is read here and posted once. */
function tokenFromLocation(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function ResetPasswordForm() {
  // Read after hydration (the server never sees the fragment).
  const token = React.useSyncExternalStore(subscribeHash, tokenFromLocation, () => null);
  const [form, setForm] = React.useState({ password: "", confirm: "", code: "" });
  const [needsCode, setNeedsCode] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2Icon className="size-5 text-success-foreground" aria-hidden /> Your password was changed
        </p>
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }
  if (token === null) return null;
  if (!token) {
    return (
      <p role="alert" className="text-body text-danger-foreground">
        This page needs the link from the email. Open the link again, or ask for a new one.
      </p>
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
          const result = await chooseNewPassword({ token, ...form });
          if (result.ok) {
            window.history.replaceState(null, "", window.location.pathname);
            setDone(true);
          } else {
            if (result.codeRequired) setNeedsCode(true);
            setError(result.message);
          }
        });
      }}
    >
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={form.password}
          onChange={set("password")}
        />
        <p className="text-meta text-muted-foreground">At least 12 characters and not repetitive.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-password-again">New password again</Label>
        <Input id="new-password-again" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="reset-code">
          {needsCode
            ? "Code from your authenticator app, or a recovery code *"
            : "Code from your authenticator app or a recovery code (if you use two-step verification)"}
        </Label>
        <Input
          id="reset-code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          value={form.code}
          onChange={set("code")}
        />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
