"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Label, toast } from "@healthcare/ui/primitives";
import type { PractitionerSignatureSetting } from "@/lib/api/types";
import { savePractitionerSignatureSetting } from "../procedure-actions";

export function SignatureSetting({ setting }: { setting: PractitionerSignatureSetting }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(setting.enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await savePractitionerSignatureSetting({ enabled, version: setting.version });
          if (result.ok) {
            toast.success("Setting saved");
            router.refresh();
          } else setError(result.message);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Checkbox id="print-signatures" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        <Label htmlFor="print-signatures">Print the practitioner&apos;s signature on medical certificates and referral letters</Label>
      </div>
      {error ? (
        <p role="alert" className="text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
