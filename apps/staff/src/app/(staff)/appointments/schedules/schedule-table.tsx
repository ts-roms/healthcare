"use client";

import * as React from "react";
import { Badge, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { WEEKDAYS } from "./labels";
import { RetireSchedule } from "./schedule-forms";

export interface ScheduleTableRow {
  id: string;
  practitionerId: string;
  practitionerName: string;
  dayOfWeek: number;
  start: string;
  end: string;
  slotMinutes: number;
  room: string | null;
  /** "from 8 Oct 2026" or "8 Oct 2026 – 31 Dec 2026", already in the facility's words. */
  valid: string;
}

/** Monday first, as staff read a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Every practitioner's weekly schedule at the facility in one table, narrowed with a practitioner and a day dropdown
 * (a facility can have dozens of practitioners). Sorted by practitioner, then day (Monday first), then start time.
 */
export function ScheduleTable({
  rows,
  practitioners,
  todayDow,
  configure,
}: {
  rows: ScheduleTableRow[];
  practitioners: { id: string; name: string }[];
  todayDow: number;
  configure: boolean;
}) {
  const [practitionerId, setPractitionerId] = React.useState("");
  const [dayOfWeek, setDayOfWeek] = React.useState("");

  const blocksOf = (id: string) => rows.filter((r) => r.practitionerId === id);
  const shown = rows
    .filter((r) => (!practitionerId || r.practitionerId === practitionerId) && (dayOfWeek === "" || r.dayOfWeek === Number(dayOfWeek)))
    .sort(
      (a, b) =>
        a.practitionerName.localeCompare(b.practitionerName) ||
        WEEK_ORDER.indexOf(a.dayOfWeek as (typeof WEEK_ORDER)[number]) - WEEK_ORDER.indexOf(b.dayOfWeek as (typeof WEEK_ORDER)[number]) ||
        a.start.localeCompare(b.start),
    );
  const withoutSchedule = practitioners.filter((p) => blocksOf(p.id).length === 0);
  const chosen = practitioners.find((p) => p.id === practitionerId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="schedule-practitioner">Practitioner</Label>
          <NativeSelect id="schedule-practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
            <option value="">All practitioners ({practitioners.length})</option>
            {practitioners.map((p) => {
              const blocks = blocksOf(p.id);
              const today = blocks.some((b) => b.dayOfWeek === todayDow);
              return (
                <option key={p.id} value={p.id}>
                  {p.name} — {blocks.length === 0 ? "no schedule" : `${blocks.length} block${blocks.length === 1 ? "" : "s"}${today ? ", works today" : ""}`}
                </option>
              );
            })}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="schedule-day">Day</Label>
          <NativeSelect id="schedule-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            <option value="">Every day</option>
            {WEEK_ORDER.map((d) => (
              <option key={d} value={String(d)}>
                {WEEKDAYS[d]}
                {d === todayDow ? " (today)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="ml-auto text-meta text-muted-foreground" role="status">
          {shown.length} of {rows.length} schedule block{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="max-h-[32rem] [scrollbar-width:thin] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Practitioner</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Slots</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Valid</TableHead>
              {configure ? <TableHead className="w-0" aria-label="Actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={configure ? 7 : 6} className="py-6 text-center text-muted-foreground">
                  {chosen ? `${chosen.name} has no schedule ${dayOfWeek === "" ? "here" : `on ${WEEKDAYS[Number(dayOfWeek)]}`}.` : "No schedules match."}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.practitionerName}</TableCell>
                  <TableCell>
                    {WEEKDAYS[r.dayOfWeek]}
                    {r.dayOfWeek === todayDow ? (
                      <Badge variant="info" className="ml-2">
                        Today
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular">
                    {r.start}–{r.end}
                  </TableCell>
                  <TableCell>{r.slotMinutes} min</TableCell>
                  <TableCell>{r.room ?? <span className="text-muted-foreground">Any</span>}</TableCell>
                  <TableCell className="text-meta text-muted-foreground">{r.valid}</TableCell>
                  {configure ? (
                    <TableCell>
                      <RetireSchedule scheduleId={r.id} label={`${r.practitionerName}, ${WEEKDAYS[r.dayOfWeek]} ${r.start}–${r.end}`} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!practitionerId && withoutSchedule.length > 0 ? (
        <p className="text-meta text-muted-foreground">No schedule here yet: {withoutSchedule.map((p) => p.name).join(", ")}.</p>
      ) : null}
    </div>
  );
}
