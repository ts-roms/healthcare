"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox } from "@healthcare/ui/primitives";
import type { ServicePointSettings } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { saveServicePointSettings } from "./actions";

/** The facility's routing settings (migration 0115): whether a route sending a patient on calls them automatically. */
export function RoutingSettings({ settings }: { settings: ServicePointSettings }) {
  const [autoCall, setAutoCall] = React.useState(settings.autoCallOnRoute);
  const { pending, run } = useServerAction();
  return (
    <Card className="mx-4">
      <CardHeader>
        <CardTitle>Routes</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveServicePointSettings({ facilityId: settings.facilityId, autoCallOnRoute: autoCall, version: settings.version ?? undefined }),
              autoCall ? "Patients are called automatically when a route sends them on" : "Patients are not called automatically",
            );
          }}
        >
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={autoCall}
              onCheckedChange={(checked) => setAutoCall(checked === true)}
              aria-label="Call the patient when a route sends them on"
            />
            Call the patient when a route sends them on
          </label>
          <p className="text-meta text-muted-foreground">
            When staff select <strong>Done here, send on</strong>, the patient is called to the next service point&apos;s <strong>Location</strong> (its name
            when none is set) as if typed under <strong>Call patient to</strong>, so the waiting-room display shows and announces it. Off: the visit moves and
            staff call the patient themselves.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={pending || autoCall === settings.autoCallOnRoute}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
