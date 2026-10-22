"use client";

import * as React from "react";
import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Label, NativeSelect } from "@healthcare/ui/primitives";
import type { ServicePoint } from "@/lib/api/types";
import { SERVICE_POINT_KIND_LABEL } from "@/lib/clinic-mapping";

/** How many stops a route may hold (the API's limit). */
export const MAX_ROUTE_STOPS = 10;

/**
 * An ordered list of service points — the stops a visit's route goes through after the one before it (migration 0115).
 * The same stop may not follow itself, nor the stop before the list (`after`), because "send on" would then go nowhere;
 * a service point may otherwise appear more than once (laboratory, X-ray, laboratory again).
 */
export function RouteStopsEditor({
  id,
  servicePoints,
  stops,
  after,
  disabled,
  onChange,
}: {
  id: string;
  /** The facility's active service points. */
  servicePoints: ServicePoint[];
  /** The planned stops, in order, as service point ids. */
  stops: string[];
  /** The service point the visit is at (or its first stop) before these; null = the consultation line. */
  after: string | null;
  disabled?: boolean;
  onChange: (stops: string[]) => void;
}) {
  const [adding, setAdding] = React.useState("");
  const last = stops.at(-1) ?? after;
  const choices = servicePoints.filter((s) => s.id !== last);
  const name = (servicePointId: string) => servicePoints.find((s) => s.id === servicePointId)?.name ?? "Service point";
  const add = () => {
    if (!adding || stops.length >= MAX_ROUTE_STOPS) return;
    onChange([...stops, adding]);
    setAdding("");
  };
  return (
    <div className="grid gap-2">
      {stops.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-1" aria-label="Planned stops">
          {stops.map((stop, index) => (
            <li key={`${stop}:${index}`} className="flex items-center gap-1">
              {index > 0 ? <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-table">
                {name(stop)}
                {!disabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-5"
                    aria-label={`Remove ${name(stop)} from the route`}
                    onClick={() => onChange(stops.filter((_, i) => i !== index))}
                  >
                    <XIcon className="size-3" />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <Label htmlFor={id}>{stops.length === 0 ? "Then" : "Then"}</Label>
          <NativeSelect
            id={id}
            value={adding}
            placeholder="Choose…"
            emptyText="No service points set up"
            disabled={disabled || stops.length >= MAX_ROUTE_STOPS}
            onChange={(e) => setAdding(e.target.value)}
          >
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {SERVICE_POINT_KIND_LABEL[s.kind]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !adding || stops.length >= MAX_ROUTE_STOPS} onClick={add}>
          <PlusIcon /> Add stop
        </Button>
      </div>
    </div>
  );
}
