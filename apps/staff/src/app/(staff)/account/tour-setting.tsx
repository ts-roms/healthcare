"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Switch, toast } from "@healthcare/ui/primitives";
import { TOUR_CHANGE_EVENT, TOUR_START_EVENT, isTourEnabled, resetTourSeen, setTourEnabled } from "@/lib/tour";

function subscribe(onChange: () => void) {
  window.addEventListener(TOUR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(TOUR_CHANGE_EVENT, onChange);
}

/** The guided-tour switch and a button to run it now. A per-browser preference: it is read from this browser's storage. */
/** `offered` = the organization's switch (Settings → Guided tour); when it is off nobody can start the tour. */
export function TourSetting({ offered }: { offered: boolean }) {
  // Read from this browser's storage; null while the server-rendered page has not hydrated yet.
  const enabled = React.useSyncExternalStore(subscribe, isTourEnabled, () => null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guided tour</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="tour-enabled" className="text-body font-medium">
              Show the guided tour
            </Label>
            <p className="mt-1 text-meta text-muted-foreground">
              When on, a short walk through the menu, search, facility, notifications and help appears the first time this browser opens the app. When off, it
              never starts by itself.
            </p>
          </div>
          <Switch
            id="tour-enabled"
            disabled={enabled === null || !offered}
            checked={enabled ?? false}
            onCheckedChange={(on) => {
              setTourEnabled(on);
              if (on) resetTourSeen();
              toast.success(on ? "Guided tour turned on" : "Guided tour turned off");
            }}
          />
        </div>
        {offered ? null : <p className="text-meta text-muted-foreground">Your organization has turned the guided tour off.</p>}
        <div>
          <Button variant="outline" disabled={!enabled || !offered} onClick={() => window.dispatchEvent(new Event(TOUR_START_EVENT))}>
            Start the tour now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
