"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { RecordsRequestSetting } from "@/lib/api/types";
import { saveRecordsRequestSetting } from "./actions";

/** The organization's own records-request procedure (nothing is suggested by the platform). */
export function ProcedureForm({ setting, canEdit }: { setting: RecordsRequestSetting; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({
    responseDays: setting.responseDays === null ? "" : String(setting.responseDays),
    identityCheckRequired: setting.identityCheckRequired,
    patientNotice: setting.patientNotice ?? "",
  });
  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveRecordsRequestSetting({
            responseDays: f.responseDays ? Number.parseInt(f.responseDays, 10) : null,
            identityCheckRequired: f.identityCheckRequired,
            patientNotice: f.patientNotice.trim() || null,
            version: setting.version,
          });
          if (result.ok) {
            toast.success("Procedure saved");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        <div className="grid gap-1">
          <Label htmlFor="response-days">Respond within (days from the request)</Label>
          <Input
            id="response-days"
            inputMode="numeric"
            className="w-32"
            placeholder="None"
            value={f.responseDays}
            onChange={(e) => setF({ ...f, responseDays: e.target.value.replace(/\D/g, "") })}
          />
          <p className="text-meta text-muted-foreground">Each new request gets a response date; open requests past it are flagged. Leave empty for none.</p>
        </div>
        <label className="flex items-start gap-2 text-table">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={f.identityCheckRequired}
            onChange={(e) => setF({ ...f, identityCheckRequired: e.target.checked })}
          />
          <span>
            Record how the requester&apos;s identity was confirmed before sharing
            <span className="block text-meta text-muted-foreground">Sharing is refused until staff write how they checked it.</span>
          </span>
        </label>
        <div className="grid gap-1">
          <Label htmlFor="patient-notice">What patients read before asking (optional)</Label>
          <Textarea
            id="patient-notice"
            rows={4}
            maxLength={1500}
            placeholder="In your own words: fees, identification to bring, how answers are given."
            value={f.patientNotice}
            onChange={(e) => setF({ ...f, patientNotice: e.target.value })}
          />
        </div>
        {canEdit ? (
          <Button type="submit" className="self-start" disabled={pending}>
            Save procedure
          </Button>
        ) : (
          <p className="text-meta text-muted-foreground">Only an organization administrator changes the procedure.</p>
        )}
      </fieldset>
    </form>
  );
}
