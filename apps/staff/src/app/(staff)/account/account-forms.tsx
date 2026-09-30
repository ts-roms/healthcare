"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { beginTwoStep, changeOwnPassword, confirmTwoStep, renewRecoveryCodes, turnOffTwoStep } from "./actions";

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-table text-danger">
      {message}
    </p>
  ) : null;
}

export function PasswordForm({ temporary = false }: { temporary?: boolean } = {}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await changeOwnPassword(form);
          if (result.ok) {
            toast.success("Password changed; your other sessions were signed out");
            setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
            if (temporary) router.refresh();
          } else setError(result.message);
        });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="current-password">{temporary ? "Temporary password" : "Current password"}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={set("currentPassword")} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={form.newPassword}
          onChange={set("newPassword")}
          aria-describedby="new-password-hint"
        />
        <p id="new-password-hint" className="text-meta text-muted-foreground">
          At least 12 characters and not repetitive. A short sentence you will remember works well.
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="confirm-password">New password again</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={set("confirmPassword")} />
      </div>
      <FormError message={error} />
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Changing…" : temporary ? "Choose this password" : "Change password"}
      </Button>
    </form>
  );
}

/**
 * Turn two-step verification on (scan or type the setup key, then confirm a code) or off (password and a code). With
 * `required`, the organization requires it and it cannot be turned off.
 */
export function TwoStepSettings({ enabled, required = false }: { enabled: boolean; required?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUri: string } | null>(null);
  const [turningOff, setTurningOff] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);

  if (recoveryCodes) return <RecoveryCodesShown codes={recoveryCodes} onSaved={() => router.refresh()} />;

  if (enabled) {
    if (required) return <p className="text-meta text-muted-foreground">Your organization requires it, so it cannot be turned off.</p>;
    if (!turningOff) {
      return (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setTurningOff(true)}>
          Turn off…
        </Button>
      );
    }
    return (
      <form
        className="flex flex-col gap-2 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await turnOffTwoStep(password, code);
            if (result.ok) {
              toast.success("Two-step verification is off");
              setTurningOff(false);
              setPassword("");
              setCode("");
              router.refresh();
            } else setError(result.message);
          });
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="off-password">Your password</Label>
          <Input id="off-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="off-code">Code from your authenticator app, or a recovery code</Label>
          <Input
            id="off-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            required
            className="font-mono tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {pending ? "Turning off…" : "Turn off"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTurningOff(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (!setup) {
    return (
      <>
        <Button
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await beginTwoStep();
              if (result.ok) setSetup(result.data);
              else setError(result.message);
            });
          }}
        >
          {pending ? "Starting…" : "Turn on"}
        </Button>
        <FormError message={error} />
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await confirmTwoStep(code);
          if (result.ok) {
            toast.success("Two-step verification is on");
            setSetup(null);
            setCode("");
            // The page refreshes once the codes are saved.
            setRecoveryCodes(result.data.recoveryCodes);
          } else setError(result.message);
        });
      }}
    >
      <ol className="list-decimal pl-5">
        <li>
          In an authenticator app (for example Google Authenticator or Microsoft Authenticator), add an account with this setup key:
          <p className="my-1 rounded bg-muted/60 p-2 font-mono break-all select-all">{setup.secret}</p>
          On a phone,{" "}
          <a href={setup.otpauthUri} className="font-medium text-primary underline-offset-4 hover:underline">
            open it in your authenticator app
          </a>
          .
        </li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="grid gap-1">
        <Label htmlFor="on-code">Code from the app</Label>
        <Input
          id="on-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          className="font-mono tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Checking…" : "Turn on"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setSetup(null);
            setCode("");
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Recovery codes are shown only once: the person saves them before going on. */
function RecoveryCodesShown({ codes, onSaved }: { codes: string[]; onSaved: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="font-medium">Save your recovery codes</p>
      <p className="text-muted-foreground">
        Each one signs you in once without your phone. Write them down or print them and keep them somewhere safe, away from your phone. They are not shown
        again.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded bg-muted/60 p-2 font-mono select-all" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button size="sm" className="self-start" onClick={onSaved}>
        I have saved them
      </Button>
    </div>
  );
}

/** How many recovery codes are left, and a new set (password and the app's current code); the old ones stop working. */
export function RecoveryCodesSettings({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[] | null>(null);
  if (codes) {
    return (
      <RecoveryCodesShown
        codes={codes}
        onSaved={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className={remaining <= 2 ? "font-medium text-warning-foreground" : "text-muted-foreground"}>
        {remaining === 0 ? "No recovery codes left." : `${remaining} recovery code${remaining === 1 ? "" : "s"} left.`}
        {remaining <= 2 ? " Make a new set so you can still sign in without your phone." : null}
      </p>
      {open ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await renewRecoveryCodes(password, code);
              if (result.ok) {
                setOpen(false);
                setPassword("");
                setCode("");
                setCodes(result.data.recoveryCodes);
              } else setError(result.message);
            });
          }}
        >
          <p className="text-meta text-muted-foreground">Your old recovery codes stop working.</p>
          <div className="grid gap-1">
            <Label htmlFor="renew-password">Your password</Label>
            <Input
              id="renew-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="renew-code">Code from your authenticator app</Label>
            <Input
              id="renew-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              className="font-mono tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Making…" : "Make new codes"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          New recovery codes…
        </Button>
      )}
    </div>
  );
}
