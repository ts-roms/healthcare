"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { hasEnoughInk, type SignatureStroke } from "@healthcare/domain";
import { SignaturePad } from "@healthcare/ui/healthcare";
import { Button, Checkbox, Input, Label } from "@healthcare/ui/primitives";
import type { PortalForm } from "@/lib/api/types";
import { signForm } from "./actions";

/**
 * Sign a requested form: confirm you read it, draw your signature, enter your password again and send. When the patient is
 * a minor the clinic asks a parent or guardian to sign: the form is then opened while acting for the child.
 */
export function SignForm({ form }: { form: PortalForm }) {
  const router = useRouter();
  const [read, setRead] = React.useState(false);
  const [strokes, setStrokes] = React.useState<SignatureStroke[]>([]);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const ready = read && hasEnoughInk(strokes) && password.length > 0;

  return (
    <div role="group" aria-label={`Sign ${form.wording.title}`} className="flex flex-col gap-3 border-t pt-3">
      {form.representativeRequired ? (
        <p className="text-meta text-muted-foreground">
          This patient is a minor, so a parent or guardian signs. Sign in as the parent or guardian and open this form while acting for the patient.
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <Checkbox id={`${form.id}-read`} checked={read} onCheckedChange={(v) => setRead(v === true)} className="mt-1" />
        <Label htmlFor={`${form.id}-read`} className="font-normal">
          I have read this form and I agree to it.
        </Label>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${form.id}-pad`}>Your signature</Label>
        <SignaturePad id={`${form.id}-pad`} onChange={setStrokes} disabled={pending} />
      </div>
      <div className="grid max-w-xs gap-1">
        <Label htmlFor={`${form.id}-password`}>Your password, to confirm it is you</Label>
        <Input id={`${form.id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={!ready || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await signForm({ requestId: form.id, password, strokes });
              if (result.ok) router.refresh();
              else
                setError(
                  result.code === "minor_requires_representative"
                    ? "This patient is a minor: a parent or guardian signs this form."
                    : result.code === "invalid_credentials"
                      ? "The password is not correct."
                      : result.message,
                );
            })
          }
        >
          Sign and send
        </Button>
      </div>
    </div>
  );
}
