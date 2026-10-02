"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { ManagementReportSchedule } from "@/lib/api/types";
import { EXPORT_TABLES } from "@/lib/management-mapping";
import { saveReportSchedule, setReportScheduleStatus } from "./actions";

interface Option {
  id: string;
  name: string;
  email?: string;
}

const CADENCE_LABEL = { weekly: "Weekly (Monday to Sunday)", monthly: "Monthly (calendar month)" } as const;

/** The organization's report schedules: a list with pause/resume, and a form to add or change one. */
export function ScheduleEditor({
  schedules,
  facilities,
  users,
  canManage,
  currentUserId,
}: {
  schedules: ManagementReportSchedule[];
  facilities: Option[];
  /** Active staff to pick recipients from; null when the user may not read the staff list. */
  users: Option[] | null;
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<ManagementReportSchedule | "new" | null>(null);
  const userName = (id: string) => users?.find((u) => u.id === id)?.name ?? (id === currentUserId ? "You" : "A member");

  const setStatus = (schedule: ManagementReportSchedule, status: "active" | "paused") =>
    startTransition(async () => {
      const result = await setReportScheduleStatus(schedule.id, status, schedule.version);
      if (result.ok) {
        toast.success(status === "paused" ? `${schedule.name} paused` : `${schedule.name} resumed`);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Schedules</CardTitle>
        {canManage && editing === null ? (
          <Button size="sm" onClick={() => setEditing("new")} disabled={users === null}>
            New schedule
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage && users === null ? (
          <p className="text-table text-muted-foreground">Choosing recipients needs access to the staff list (user.read). Ask an administrator.</p>
        ) : null}
        {schedules.length === 0 ? (
          <p className="text-table text-muted-foreground">No scheduled reports yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-table">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.name} <Badge variant={s.status === "active" ? "success" : "neutral"}>{s.status === "active" ? "Active" : "Paused"}</Badge>
                  </p>
                  <p className="text-muted-foreground">
                    {CADENCE_LABEL[s.cadence]} ·{" "}
                    {s.facilityId === null ? "All facilities" : (facilities.find((f) => f.id === s.facilityId)?.name ?? "A facility")}
                  </p>
                  <p className="text-muted-foreground">Tables: {s.tables.map((t) => EXPORT_TABLES.find((e) => e.key === t)?.label ?? t).join(", ")}</p>
                  <p className="text-muted-foreground">
                    To: {s.recipientUserIds.map(userName).join(", ")} · produced with{" "}
                    {s.ownerUserId === currentUserId ? "your" : `${userName(s.ownerUserId)}'s`} permissions
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)} disabled={pending || users === null}>
                      Change
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(s, s.status === "active" ? "paused" : "active")} disabled={pending}>
                      {s.status === "active" ? "Pause" : "Resume"}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editing !== null && users !== null ? (
          <ScheduleForm
            key={editing === "new" ? "new" : editing.id}
            schedule={editing === "new" ? null : editing}
            facilities={facilities}
            users={users}
            currentUserId={currentUserId}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScheduleForm({
  schedule,
  facilities,
  users,
  currentUserId,
  onDone,
}: {
  schedule: ManagementReportSchedule | null;
  facilities: Option[];
  users: Option[];
  currentUserId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(schedule?.name ?? "");
  const [cadence, setCadence] = React.useState<"weekly" | "monthly">(schedule?.cadence ?? "weekly");
  const [facilityId, setFacilityId] = React.useState<string>(schedule?.facilityId ?? "");
  const [tables, setTables] = React.useState<string[]>(schedule?.tables ?? ["summary"]);
  const [recipients, setRecipients] = React.useState<string[]>(schedule?.recipientUserIds ?? [currentUserId]);
  const toggle = (list: string[], set: (next: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  const changesOwner = schedule !== null && schedule.ownerUserId !== currentUserId;

  return (
    <form
      className="flex flex-col gap-4 rounded-md border p-4"
      aria-label={schedule ? "Change schedule" : "New schedule"}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveReportSchedule(
            { name, cadence, tables, facilityId: facilityId || null, recipientUserIds: recipients },
            schedule ? { id: schedule.id, version: schedule.version } : null,
          );
          if (result.ok) {
            toast.success(schedule ? "Schedule changed" : "Report scheduled");
            onDone();
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1 sm:col-span-3">
          <Label htmlFor="rs-name">Name</Label>
          <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="rs-cadence">How often</Label>
          <NativeSelect id="rs-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as "weekly" | "monthly")}>
            <option value="weekly">{CADENCE_LABEL.weekly}</option>
            <option value="monthly">{CADENCE_LABEL.monthly}</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="rs-facility">Facility</Label>
          <NativeSelect id="rs-facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            <option value="">All facilities I may report on</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-table font-medium">Tables</legend>
        <div className="grid gap-1 sm:grid-cols-3">
          {EXPORT_TABLES.map((t) => (
            <label key={t.key} className="flex items-center gap-2 text-table">
              <Checkbox checked={tables.includes(t.key)} onCheckedChange={(v) => toggle(tables, setTables, t.key, v === true)} />
              {t.label}
              {t.revenue ? <span className="text-meta text-muted-foreground">(needs billing reports)</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="text-table font-medium">Recipients</legend>
        <p className="text-meta text-muted-foreground">
          Only members who may view the management dashboard for this scope can be chosen; the API refuses others.
        </p>
        <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-table">
              <Checkbox checked={recipients.includes(u.id)} onCheckedChange={(v) => toggle(recipients, setRecipients, u.id, v === true)} />
              {u.name} <span className="text-meta text-muted-foreground">{u.email}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {changesOwner ? (
        <p role="note" className="text-meta text-muted-foreground">
          Saving makes you the schedule&apos;s owner: reports will be produced with your permissions from now on.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || tables.length === 0 || recipients.length === 0 || name.trim().length < 2}>
          {schedule ? "Save changes" : "Schedule"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
