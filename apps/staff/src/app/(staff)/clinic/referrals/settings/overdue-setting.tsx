"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import type { ReferralSettings } from "@/lib/api/types";
import { saveReferralSettings } from "../actions";

export function OverdueSetting({ settings }: { settings: ReferralSettings }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [enabled, setEnabled] = React.useState(settings.overdueAfterDays !== null);
  const [days, setDays] = React.useState(settings.overdueAfterDays ? String(settings.overdueAfterDays) : "");
  const value = enabled ? Number(days) : null;
  const valid = value === null || (Number.isInteger(value) && value >= 1 && value <= 365);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveReferralSettings(value, settings.version);
          if (result.ok) {
            toast.success(value === null ? "Overdue flag turned off" : `Referrals are overdue ${value} days after they were sent without an answer or reply`);
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <label className="flex items-center gap-2">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        Flag referrals still awaiting an answer or reply
      </label>
      {enabled ? (
        <div className="grid max-w-48 gap-1">
          <Label htmlFor="overdue-days">After how many days</Label>
          <Input id="overdue-days" type="number" min={1} max={365} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={pending || !valid}>
          Save
        </Button>
      </div>
    </form>
  );
}
