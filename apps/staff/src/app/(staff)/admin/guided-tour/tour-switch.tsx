"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, Label, Switch } from "@healthcare/ui/primitives";
import type { StaffTourSetting } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { saveTourSetting } from "./actions";

export function TourSwitch({ setting }: { setting: StaffTourSetting }) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guided tour</CardTitle>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="org-tour-enabled" className="text-body font-medium">
            Offer the guided tour to staff
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">
            When on, each member of staff sees a short walk through the app the first time they open it in a browser, and can run it again from My account. When
            off, it never starts and no one can start it.
          </p>
        </div>
        <Switch
          id="org-tour-enabled"
          disabled={pending}
          checked={setting.enabled}
          onCheckedChange={(enabled) =>
            run(() => saveTourSetting({ enabled, version: setting.version }), enabled ? "Guided tour turned on" : "Guided tour turned off")
          }
        />
      </CardContent>
    </Card>
  );
}
