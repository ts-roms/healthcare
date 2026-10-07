"use client";

import * as React from "react";
import Link from "next/link";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button, Checkbox, Label } from "@healthcare/ui/primitives";
import { type AuthFormState, passkeySignIn, passkeySignInOptions, signIn } from "../actions";
import { Field, FormError } from "../form-parts";

/** Sign-in: the password, then — for accounts with two-step verification — the code. "Start over" remounts the steps. */
export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [attempt, setAttempt] = React.useState(0);
  return <LoginSteps key={attempt} next={next} notice={notice} onRestart={() => setAttempt((a) => a + 1)} />;
}

function LoginSteps({ next, notice, onRestart }: { next: string; notice?: string; onRestart: () => void }) {
  const [state, action, pending] = React.useActionState(signIn, {} as AuthFormState);
  const [passkeyError, setPasskeyError] = React.useState<string>();
  const [passkeyPending, startPasskey] = React.useTransition();
  const rememberRef = React.useRef<HTMLButtonElement>(null);

  /** The browser asks for the phone's or computer's lock (PIN, fingerprint or face); the API checks the answer. */
  function signInWithPasskey() {
    setPasskeyError(undefined);
    startPasskey(async () => {
      const prepared = await passkeySignInOptions();
      if ("error" in prepared) return setPasskeyError(prepared.error);
      let response: unknown;
      try {
        response = await startAuthentication({ optionsJSON: prepared.options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      } catch {
        return setPasskeyError("The passkey was not used. Try again, or enter a code.");
      }
      const rememberDevice = rememberRef.current?.getAttribute("data-state") === "checked";
      const result = await passkeySignIn({ response, rememberDevice, next });
      if (result?.error) setPasskeyError(result.error);
    });
  }

  if (state.step === "mfa") {
    return (
      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="intent" value="mfa" />
        <input type="hidden" name="passkeys" value={state.passkeys ? "1" : "0"} />
        <p className="text-body text-muted-foreground">
          {state.passkeys
            ? "Your password is right. Now use your passkey, or enter the 6-digit code from your authenticator app."
            : "Your password is right. Now enter the 6-digit code from your authenticator app."}
        </p>
        <FormError message={passkeyError ?? state.error} />
        {state.passkeys ? (
          <Button type="button" size="lg" onClick={signInWithPasskey} disabled={passkeyPending || pending}>
            {passkeyPending ? "Waiting for your passkey…" : "Use a passkey"}
          </Button>
        ) : null}
        <Field
          name="code"
          label="Code"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          autoFocus
          hint="Lost your phone? Enter a recovery code instead, like K7M2P-X9QRT."
          error={state.fieldErrors?.code}
        />
        <div className="flex items-start gap-2">
          <Checkbox id="remember-device" name="rememberDevice" className="mt-0.5" ref={rememberRef} />
          <Label htmlFor="remember-device" className="text-body leading-snug font-normal">
            Don&apos;t ask for a code on this browser for 30 days. Only on a device that is yours.
          </Label>
        </div>
        <Button type="submit" size="lg" variant={state.passkeys ? "outline" : "default"} disabled={pending || passkeyPending}>
          {pending ? "Checking…" : state.passkeys ? "Sign in with the code" : "Sign in"}
        </Button>
        <Button type="button" onClick={onRestart} variant="link">
          Start over
        </Button>
      </form>
    );
  }
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
      <p className="text-meta text-muted-foreground">
        <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
