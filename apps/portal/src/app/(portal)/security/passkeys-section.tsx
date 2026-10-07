"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyRoundIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import type { PortalPasskeyList } from "@/lib/api/types";
import { resultDate } from "@/lib/records";
import { securityMessage } from "@/lib/security";
import { addPasskey, passkeyOptions, removePasskey } from "./actions";

/**
 * Passkeys (migration 0108): the phone's or computer's own lock (PIN, fingerprint or face) answers the second step of
 * signing in instead of a code. Shown only with two-step verification on; the app and the recovery codes stay the
 * fallback. Adding one needs the password and a current code.
 */
export function PasskeysSection({ list, timeZone }: { list: PortalPasskeyList; timeZone: string }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const add = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      const options = await passkeyOptions({ password: String(form.get("password") ?? ""), code: String(form.get("code") ?? "") });
      if (!options.ok) return setMessage(securityMessage(options.code, options.message));
      let response: unknown;
      try {
        response = await startRegistration({ optionsJSON: options.data as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      } catch {
        return setMessage("The passkey was not made: it was cancelled, or this browser cannot make passkeys.");
      }
      const saved = await addPasskey({ response, label: String(form.get("label") ?? "") });
      if (!saved.ok) return setMessage(securityMessage(saved.code, saved.message));
      setAdding(false);
      setMessage("Passkey added. Next time you sign in, choose Use a passkey.");
      router.refresh();
    });
  };

  const remove = (id: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await removePasskey(id);
      if (!result.ok) return setMessage(securityMessage(result.code, result.message));
      setMessage("Passkey removed.");
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-labelledby="passkeys-heading">
      <h2 id="passkeys-heading" className="flex items-center gap-2 font-semibold">
        <KeyRoundIcon className="size-4" aria-hidden /> Passkeys
      </h2>
      <p className="text-body text-muted-foreground">
        A passkey lets your phone or computer unlock the second step with its own PIN, fingerprint or face, instead of typing a code. Your password is still
        needed, and your authenticator app and recovery codes keep working.
      </p>
      {!list.available ? (
        <p className="text-body text-muted-foreground">Passkeys are not available on this MyHealth address.</p>
      ) : (
        <>
          {list.passkeys.length === 0 ? (
            <p className="text-body text-muted-foreground">You have no passkey.</p>
          ) : (
            <ul className="flex flex-col divide-y" aria-label="Passkeys">
              {list.passkeys.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-body font-medium">{p.label}</p>
                    <p className="text-meta text-muted-foreground">
                      Added {resultDate(p.createdAt, timeZone)}
                      {p.lastUsedAt ? ` · last used ${resultDate(p.lastUsedAt, timeZone)}` : " · not used yet"}
                      {p.backedUp ? " · synced to your other devices" : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => remove(p.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <form onSubmit={add} className="flex flex-col gap-3" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="passkey-password">Your password</Label>
                <Input id="passkey-password" name="password" type="password" autoComplete="current-password" required autoFocus className="h-11" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="passkey-code">Code from your authenticator app, or a recovery code</Label>
                <Input id="passkey-code" name="code" autoComplete="one-time-code" spellCheck={false} required className="h-11 font-mono tracking-widest" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="passkey-label">Name (optional)</Label>
                <Input id="passkey-label" name="label" maxLength={80} placeholder="My phone" className="h-11" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Waiting for your device…" : "Continue"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : list.passkeys.length < list.limit ? (
            <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setAdding(true)}>
              Add a passkey
            </Button>
          ) : (
            <p className="text-body text-muted-foreground">You have {list.limit} passkeys, the most an account can have.</p>
          )}
        </>
      )}
      {message ? (
        <p role="status" className="text-body text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
