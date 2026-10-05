"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import type { PortalMfaSetup, PortalMfaStatus } from "@/lib/api/types";
import { resultDate } from "@/lib/records";
import { recoveryCodesLow, recoveryCodesText, securityMessage } from "@/lib/security";
import { beginMfa, disableMfa, enableMfa, renewRecoveryCodes } from "./actions";

type Panel = "none" | "password" | "scan" | "renew" | "disable";

/**
 * Two-step verification: an authenticator app after the password. Turning it on shows the setup key (and a link that
 * opens the app on a phone), checks a code, then shows the recovery codes once — they stay here only until the patient
 * says they are saved.
 */
export function MfaSection({ status, timeZone }: { status: PortalMfaStatus; timeZone: string }) {
  const [panel, setPanel] = React.useState<Panel>("none");
  const [setup, setSetup] = React.useState<PortalMfaSetup | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>, run: (form: FormData) => Promise<void>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      await run(form);
    });
  };
  const text = (form: FormData, name: string) => String(form.get(name) ?? "");
  const fail = (code: string | undefined, fallback: string) => setMessage(securityMessage(code, fallback));

  if (codes) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4" aria-labelledby="codes-heading">
        <h2 id="codes-heading" className="font-semibold">
          Save your recovery codes
        </h2>
        <p className="text-body text-muted-foreground">
          Each code works once, if you lose your phone. They are shown only now. Keep them somewhere safe and private — not on the same phone.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 font-mono text-body" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(recoveryCodesText(codes))}>
            Copy codes
          </Button>
          <Button type="button" size="sm" onClick={() => setCodes(null)}>
            I saved them
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-labelledby="mfa-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mfa-heading" className="font-semibold">
          Two-step verification
        </h2>
        <span className={`flex items-center gap-1.5 text-body font-medium ${status.enabled ? "text-success-foreground" : "text-muted-foreground"}`}>
          {status.enabled ? <ShieldCheckIcon className="size-4" aria-hidden /> : <ShieldOffIcon className="size-4" aria-hidden />}
          {status.enabled ? "On" : "Off"}
        </span>
      </div>

      {status.enabled ? (
        <>
          <p className="text-body text-muted-foreground">
            When you sign in, you also enter a code from your authenticator app
            {status.enabledAt ? ` (on since ${resultDate(status.enabledAt, timeZone)})` : ""}.
          </p>
          <p
            className={`flex items-center gap-1.5 text-body ${recoveryCodesLow(status.recoveryCodesRemaining) ? "text-warning-foreground" : "text-muted-foreground"}`}
          >
            {recoveryCodesLow(status.recoveryCodesRemaining) ? (
              <AlertTriangleIcon className="size-4" aria-hidden />
            ) : (
              <CheckCircle2Icon className="size-4" aria-hidden />
            )}
            {status.recoveryCodesRemaining} recovery {status.recoveryCodesRemaining === 1 ? "code" : "codes"} left
            {recoveryCodesLow(status.recoveryCodesRemaining) ? " — make new ones" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel(panel === "renew" ? "none" : "renew")}>
              Make new recovery codes
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel(panel === "disable" ? "none" : "disable")}>
              Turn off
            </Button>
          </div>
          {panel === "renew" || panel === "disable" ? (
            <form
              onSubmit={(e) =>
                submit(e, async (form) => {
                  const input = { password: text(form, "password"), code: text(form, "code") };
                  if (panel === "renew") {
                    const result = await renewRecoveryCodes(input);
                    if (result.ok) {
                      setCodes(result.data.recoveryCodes);
                      setPanel("none");
                    } else fail(result.code, result.message);
                  } else {
                    const result = await disableMfa(input);
                    if (result.ok) {
                      setPanel("none");
                      setMessage("Two-step verification is off.");
                    } else fail(result.code, result.message);
                  }
                })
              }
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <p className="text-body text-muted-foreground">
                {panel === "renew"
                  ? "The old codes stop working. Enter your password and the code from your authenticator app."
                  : "Enter your password and a code from your authenticator app (or a recovery code)."}
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="mfa-password">Your password</Label>
                <Input id="mfa-password" name="password" type="password" autoComplete="current-password" required className="h-11" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mfa-code">Code</Label>
                <Input id="mfa-code" name="code" autoComplete="one-time-code" spellCheck={false} required className="h-11 font-mono tracking-widest" />
              </div>
              <Button type="submit" size="sm" variant={panel === "disable" ? "destructive" : "default"} className="self-start" disabled={pending}>
                {pending ? "Working…" : panel === "renew" ? "Make new codes" : "Turn off two-step verification"}
              </Button>
            </form>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-body text-muted-foreground">
            Add a second step: after your password you enter a 6-digit code from an authenticator app on your phone. Even if someone learns your password, they
            cannot sign in without your phone.
          </p>
          {!status.emailVerified ? (
            <p className="text-body text-warning-foreground">Verify your email first — we send notices about two-step verification there.</p>
          ) : panel === "none" ? (
            <Button type="button" size="sm" className="self-start" onClick={() => setPanel("password")}>
              Turn on
            </Button>
          ) : null}
          {status.emailVerified && panel === "password" ? (
            <form
              onSubmit={(e) =>
                submit(e, async (form) => {
                  const result = await beginMfa(text(form, "password"));
                  if (result.ok) {
                    setSetup(result.data);
                    setPanel("scan");
                  } else fail(result.code, result.message);
                })
              }
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <div className="grid gap-1.5">
                <Label htmlFor="setup-password">Your password</Label>
                <Input id="setup-password" name="password" type="password" autoComplete="current-password" required autoFocus className="h-11" />
              </div>
              <Button type="submit" size="sm" className="self-start" disabled={pending}>
                {pending ? "Working…" : "Continue"}
              </Button>
            </form>
          ) : null}
          {panel === "scan" && setup ? (
            <form
              onSubmit={(e) =>
                submit(e, async (form) => {
                  const result = await enableMfa(text(form, "code"));
                  if (result.ok) {
                    setCodes(result.data.recoveryCodes);
                    setSetup(null);
                    setPanel("none");
                  } else fail(result.code, result.message);
                })
              }
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <ol className="list-decimal pl-5 text-body">
                <li>
                  Open an authenticator app (for example Google Authenticator or Microsoft Authenticator) and scan this code
                  {setup.qrSvg ? (
                    // The SVG is drawn by this app's server from the otpauth link; it holds no text, only the code's squares.
                    <span
                      role="img"
                      aria-label="QR code for your authenticator app; the setup key below is the same thing as text"
                      className="my-2 block size-44 rounded-lg border bg-white p-2 [&>svg]:size-full"
                      dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                    />
                  ) : null}
                  or add an account with this setup key:
                  <p className="my-1 rounded bg-muted/60 p-2 font-mono text-body break-all select-all">{setup.setupKey}</p>
                  On a phone,{" "}
                  <a href={setup.otpauthUri} className="font-medium text-primary underline-offset-4 hover:underline">
                    open it in your authenticator app
                  </a>
                  .
                </li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <div className="grid gap-1.5">
                <Label htmlFor="setup-code">Code from the app</Label>
                <Input
                  id="setup-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  required
                  className="h-11 font-mono tracking-widest"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Checking…" : "Turn on"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSetup(null);
                    setPanel("none");
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}
      <p className="text-meta text-muted-foreground">
        Lost your phone and your recovery codes? The clinic can turn two-step verification off after checking who you are.
      </p>
      {message ? (
        <p role="status" className="text-body text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
