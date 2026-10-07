"use client";

import * as React from "react";
import { Checkbox, Label } from "@healthcare/ui/primitives";
import type { StaffPushPreference } from "@/lib/api/types";
import { savePushPreferences } from "./actions";

/**
 * Which kinds of notice also reach this member's browsers (migration 0106). Every kind is on until turned off; the
 * notice in the app always arrives. Each change is saved at once.
 */
export function PushPreferences({ initial }: { initial: StaffPushPreference[] }) {
  const [preferences, setPreferences] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const toggle = (kind: string, enabled: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await savePushPreferences([{ kind, enabled }]);
      if (result.ok) setPreferences(result.data.preferences);
      else setError(result.message);
    });

  return (
    <fieldset className="flex flex-col gap-2" disabled={pending}>
      <legend className="text-table font-medium">Which notices reach your browsers</legend>
      <p className="text-meta text-muted-foreground">Notices you turn off here still arrive in the app; they just stop showing in your browsers.</p>
      <ul className="flex flex-col gap-1.5">
        {preferences.map((p) => (
          <li key={p.kind} className="flex items-center gap-2">
            <Checkbox id={`push-${p.kind}`} checked={p.enabled} onCheckedChange={(checked) => toggle(p.kind, checked === true)} />
            <Label htmlFor={`push-${p.kind}`} className="font-normal">
              {p.label}
            </Label>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
