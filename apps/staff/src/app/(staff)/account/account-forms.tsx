"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { beginTwoStep, changeOwnPassword, confirmTwoStep, turnOffTwoStep } from "./actions";

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

/** Turn two-step verification on (scan or type the setup key, then confirm a code) or off (password and a code). */
export function TwoStepSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUri: string } | null>(null);
  const [turningOff, setTurningOff] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");

  if (enabled) {
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
          <Label htmlFor="off-code">Code from your authenticator app</Label>
          <Input
            id="off-code"
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
            router.refresh();
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
