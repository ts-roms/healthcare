"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PenLineIcon } from "lucide-react";
import { Button, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import { saveConsentSigningSettings } from "@/app/(staff)/clinic/procedure-actions";
import type { ConsentSigningSetting } from "@/lib/api/types";

/**
 * How consent forms are signed (docs/architecture/electronic-signatures.md): the age under which a parent or guardian signs
 * (at the clinic and in MyHealth), whether patients sign requested forms in MyHealth, and how long a request stays open.
 * The age is the organization's own decision; 18 is only a reference until it confirms its value.
 */
export function ConsentSigningSettings({ setting, canConfigure }: { setting: ConsentSigningSetting; canConfigure: boolean }) {
  const router = useRouter();
  const [useAge, setUseAge] = React.useState(setting.minorAgeYears !== null);
  const [age, setAge] = React.useState(String(setting.minorAgeYears ?? 18));
  const [portal, setPortal] = React.useState(setting.portalSigningEnabled);
  const [days, setDays] = React.useState(String(setting.requestValidDays));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <section className="flex flex-col gap-3 border-t p-4" aria-labelledby="consent-signing-heading">
      <div>
        <h2 id="consent-signing-heading" className="flex items-center gap-1.5 text-body font-semibold">
          <PenLineIcon className="size-4 text-muted-foreground" aria-hidden /> Signing consent forms
        </h2>
        <p className="text-table text-muted-foreground">
          Who signs for a minor and whether patients sign in MyHealth. Your organization decides these; the platform applies them and decides nothing about who
          may sign for whom.
        </p>
      </div>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await saveConsentSigningSettings({
              minorAgeYears: useAge ? Number(age) : null,
              portalSigningEnabled: portal,
              requestValidDays: Number(days),
              version: setting.version,
            });
            if (result.ok) {
              toast.success("Signing settings saved");
              router.refresh();
            } else setError(result.message);
          });
        }}
      >
        <div className="flex items-center gap-2">
          <Checkbox id="signing-age-rule" checked={useAge} disabled={!canConfigure} onCheckedChange={(v) => setUseAge(v === true)} />
          <Label htmlFor="signing-age-rule">A parent or guardian signs for a patient under this age</Label>
        </div>
        {useAge ? (
          <div className="grid max-w-40 gap-1">
            <Label htmlFor="signing-age">Age in years</Label>
            <Input id="signing-age" inputMode="numeric" maxLength={2} value={age} disabled={!canConfigure} onChange={(e) => setAge(e.target.value)} />
            <span className="text-meta text-muted-foreground">18 is a reference until your organization confirms its own.</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Checkbox id="signing-portal" checked={portal} disabled={!canConfigure} onCheckedChange={(v) => setPortal(v === true)} />
          <Label htmlFor="signing-portal">Patients and guardians sign requested forms in MyHealth</Label>
        </div>
        <div className="grid max-w-40 gap-1">
          <Label htmlFor="signing-days">A request stays open (days)</Label>
          <Input id="signing-days" inputMode="numeric" maxLength={2} value={days} disabled={!canConfigure} onChange={(e) => setDays(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-table text-danger-foreground">
            {error}
          </p>
        ) : null}
        {canConfigure ? (
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              Save signing settings
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
