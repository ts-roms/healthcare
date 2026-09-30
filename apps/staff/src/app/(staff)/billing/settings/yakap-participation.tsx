"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, DateInput, Input, Label, toast } from "@healthcare/ui/primitives";
import type { YakapParticipation as Participation } from "@/lib/api/types";
import { recordYakapParticipation } from "./yakap-actions";

/** The facility's PhilHealth YAKAP participation reference, as issued (not verified with PhilHealth), used when YAKAP encounter packages are prepared. */
export function YakapParticipation({
  facilityId,
  facilityName,
  participation,
}: {
  facilityId: string;
  facilityName: string;
  participation: Participation | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({
    participationReference: participation?.participationReference ?? "",
    validFrom: participation?.validFrom ?? "",
    validUntil: participation?.validUntil ?? "",
  });
  const save = () =>
    startTransition(async () => {
      const result = await recordYakapParticipation({
        facilityId,
        participationReference: f.participationReference,
        validFrom: f.validFrom || undefined,
        validUntil: f.validUntil || undefined,
        version: participation?.version,
      });
      if (result.ok) {
        toast.success("YAKAP reference saved");
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>PhilHealth YAKAP participation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-body">
        <p className="text-meta text-muted-foreground">
          {facilityName}. The reference PhilHealth issued for this facility&apos;s YAKAP participation, as written on PhilHealth&apos;s document. Used when
          YAKAP encounter packages are prepared. Not verified with PhilHealth; sending to YAKAP is not connected yet.
        </p>
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Label htmlFor="yakap-reference" className="col-span-2">
            YAKAP reference
          </Label>
          <Input
            id="yakap-reference"
            className="col-span-2"
            value={f.participationReference}
            maxLength={60}
            onChange={(e) => setF({ ...f, participationReference: e.target.value })}
          />
          <Label htmlFor="yakap-valid-from">Valid from</Label>
          <Label htmlFor="yakap-valid-until">Valid until</Label>
          <DateInput id="yakap-valid-from" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
          <DateInput id="yakap-valid-until" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending || !f.participationReference.trim()}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
