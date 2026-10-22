"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Switch, toast } from "@healthcare/ui/primitives";
import { TOUR_CHANGE_EVENT, TOUR_START_EVENT, isTourEnabled, resetTourSeen, setTourEnabled } from "@/lib/tour";
import { toursForPermissions } from "@/lib/tour-steps";

function subscribe(onChange: () => void) {
  window.addEventListener(TOUR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(TOUR_CHANGE_EVENT, onChange);
}

/**
 * The guided-tour switch and the list of tours to run on request. The switch is a per-browser preference read from this browser's
 * storage; `offered` is the organization's switch (Settings → Guided tour): when it is off nobody can start a tour.
 */
export function TourSetting({ offered, permissions }: { offered: boolean; permissions: string[] }) {
  // null while the server-rendered page has not hydrated yet.
  const enabled = React.useSyncExternalStore(subscribe, isTourEnabled, () => null);
  const tours = React.useMemo(() => toursForPermissions(permissions), [permissions]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Guided tours</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="tour-enabled" className="text-body font-medium">
              Start tours by themselves
            </Label>
            <p className="mt-1 text-meta text-muted-foreground">
              When on, a short tour appears the first time this browser opens the app and, once, the first time you open each screen that has one. When off,
              nothing starts by itself; you can still start any tour below.
            </p>
          </div>
          <Switch
            id="tour-enabled"
            disabled={enabled === null || !offered}
            checked={enabled ?? false}
            onCheckedChange={(on) => {
              setTourEnabled(on);
              if (on) resetTourSeen();
              toast.success(on ? "Guided tours turned on" : "Guided tours turned off");
            }}
          />
        </div>
        {offered ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {tours.map((tour) => (
              <li key={tour.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-body font-medium">{tour.title}</p>
                  <p className="text-meta text-muted-foreground">{tour.description}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { id: tour.id } }))}>
                  Start
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-muted-foreground">Your organization has turned the guided tours off.</p>
        )}
      </CardContent>
    </Card>
  );
}
