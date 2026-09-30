"use client";

import * as React from "react";
import { CheckCircle2Icon, MailWarningIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import type { PortalEmailStatus } from "@/lib/api/types";
import { securityMessage } from "@/lib/security";
import { changeEmail, confirmEmailCode, sendEmailCode } from "./actions";

/**
 * The sign-in email: proven with a 6-digit code sent to it, and switched the same way — the new address gets the code and
 * replaces the old one only when it is entered. Switching needs the password (and the app's code with two-step verification).
 */
export function EmailSection({ status, mfaEnabled }: { status: PortalEmailStatus; mfaEnabled: boolean }) {
  const [awaiting, setAwaiting] = React.useState<string | null>(status.pending?.emailMasked ?? null);
  const [changing, setChanging] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const say = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await sendEmailCode();
      if (result.ok) {
        setAwaiting(result.data.sentTo);
        say("ok", `We sent a code to ${result.data.sentTo}. It works for ${result.data.validMinutes} minutes.`);
      } else say("error", securityMessage(result.code, result.message));
    });

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const result = await confirmEmailCode(code.trim());
      if (result.ok) {
        setAwaiting(null);
        setCode("");
        say(
          "ok",
          result.data.changed ? `Your sign-in email is now ${result.data.email}. You were signed out of your other devices.` : "Your email is verified.",
        );
      } else say("error", securityMessage(result.code, result.message));
    });
  };

  const change = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      const result = await changeEmail({
        newEmail: String(form.get("newEmail") ?? ""),
        password: String(form.get("password") ?? ""),
        code: String(form.get("code") ?? ""),
      });
      if (result.ok) {
        setChanging(false);
        setAwaiting(result.data.sentTo);
        say("ok", `We sent a code to ${result.data.sentTo}. Enter it below to switch. Until then you sign in with ${status.email}.`);
      } else say("error", securityMessage(result.code, result.message));
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-labelledby="email-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="email-heading" className="font-semibold">
          Sign-in email
        </h2>
        <span className={`flex items-center gap-1.5 text-body font-medium ${status.verified ? "text-success-foreground" : "text-warning-foreground"}`}>
          {status.verified ? <CheckCircle2Icon className="size-4" aria-hidden /> : <MailWarningIcon className="size-4" aria-hidden />}
          {status.verified ? "Verified" : "Not verified"}
        </span>
      </div>
      <p className="font-medium break-words">{status.email}</p>
      {!status.verified ? (
        <p className="text-body text-muted-foreground">
          We have not confirmed that this email is yours. Confirming it lets us warn you about changes to your account and lets you turn on two-step
          verification.
        </p>
      ) : null}

      {awaiting ? (
        <form onSubmit={confirm} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <Label htmlFor="email-code">Code sent to {awaiting}</Label>
          <Input
            id="email-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-11 font-mono text-section tracking-widest"
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || code.length !== 6}>
              {pending ? "Checking…" : "Confirm"}
            </Button>
            {status.pending?.isChange ? null : (
              <Button type="button" size="sm" variant="outline" onClick={send} disabled={pending}>
                Send a new code
              </Button>
            )}
          </div>
        </form>
      ) : !status.verified ? (
        <Button type="button" size="sm" className="self-start" onClick={send} disabled={pending}>
          {pending ? "Sending…" : "Send me a code"}
        </Button>
      ) : null}

      {changing ? (
        <form onSubmit={change} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-email">New email</Label>
            <Input id="new-email" name="newEmail" type="email" autoComplete="email" inputMode="email" required className="h-11" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="change-password">Your password</Label>
            <Input id="change-password" name="password" type="password" autoComplete="current-password" required className="h-11" />
          </div>
          {mfaEnabled ? (
            <div className="grid gap-1.5">
              <Label htmlFor="change-code">Code from your authenticator app</Label>
              <Input id="change-code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="h-11 font-mono tracking-widest" />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending…" : "Send a code to the new email"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setChanging(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setChanging(true)}>
          Change email
        </Button>
      )}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-body ${message.kind === "error" ? "text-destructive" : "text-success-foreground"}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
