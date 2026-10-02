"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, CalendarXIcon, CheckIcon, LogInIcon, UserXIcon } from "lucide-react";
import { AppointmentCard } from "@healthcare/ui/healthcare";
import { Button, Card, CardHeader, CardTitle, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { AppointmentItem, ClinicRoom, Practitioner, VisitType } from "@/lib/api/types";
import { type AppointmentAction, appointmentActions, groupByPractitioner, groupByRoom, toAppointment } from "@/lib/clinic-mapping";
import { cancelAppointment, checkInAppointment, confirmAppointment, markNoShow } from "./actions";
import { RescheduleForm } from "./reschedule-form";

export function AppointmentsDay({
  items,
  truncated,
  date,
  isToday,
  practitionerId,
  practitioners,
  visitTypes,
  canManage,
  canCheckIn,
  canOpenRecord,
  facilityId,
  timeZone,
  rooms = [],
  byRoom = false,
}: {
  items: AppointmentItem[];
  truncated: boolean;
  date: string;
  isToday: boolean;
  practitionerId: string;
  practitioners: Practitioner[];
  visitTypes: VisitType[];
  canManage: boolean;
  canCheckIn: boolean;
  canOpenRecord: boolean;
  facilityId: string;
  timeZone: string;
  /** The facility's rooms, for the by-room view (migration 0096). */
  rooms?: ClinicRoom[];
  /** Lay the day out by room instead of by practitioner. */
  byRoom?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [rescheduling, setRescheduling] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [now, setNow] = React.useState(() => new Date());
  // Re-evaluates time-based actions (a no-show is offered once the appointment has started).
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const practitionerMap = React.useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);
  const visitTypeMap = React.useMemo(() => new Map(visitTypes.map((v) => [v.id, v])), [visitTypes]);
  const groups = byRoom
    ? groupByRoom(items, rooms).map((g) => ({ key: g.roomId ?? "none", title: g.name, items: g.items }))
    : groupByPractitioner(items, practitionerMap).map((g) => ({ key: g.practitionerId, title: g.practitioner?.displayName ?? "Practitioner", items: g.items }));
  const pageHref = (view: "practitioner" | "room") =>
    `/appointments?date=${date}${practitionerId ? `&practitionerId=${practitionerId}` : ""}${view === "room" ? "&view=room" : ""}`;

  const run = (call: () => Promise<ActionResult<unknown>>, success: string | ((data: unknown) => string)) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(typeof success === "string" ? success : success(result.data));
        setCancelling(null);
        setRescheduling(null);
        setReason("");
      } else {
        toast.error(result.message);
      }
      router.refresh();
    });

  const act = (a: AppointmentItem, action: AppointmentAction) => {
    const who = a.patient?.displayName ?? "Patient";
    if (action === "confirm") run(() => confirmAppointment({ appointmentId: a.id, version: a.version }), `Confirmed ${who}`);
    if (action === "no_show") run(() => markNoShow({ appointmentId: a.id, version: a.version }), `Marked ${who} as no-show`);
    if (action === "check_in")
      run(
        () => checkInAppointment({ appointmentId: a.id }),
        (visit) => `Checked in ${who} — ticket ${(visit as { ticket: string }).ticket}`,
      );
    if (action === "cancel") {
      setRescheduling(null);
      setCancelling(a.id);
      setReason("");
    }
    if (action === "reschedule") {
      setCancelling(null);
      setRescheduling(a.id);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="practitioner-filter">Practitioner</Label>
          <NativeSelect
            emptyText="No practitioners set up"
            id="practitioner-filter"
            value={practitionerId}
            onChange={(e) => router.push(`/appointments?date=${date}${e.target.value ? `&practitionerId=${e.target.value}` : ""}${byRoom ? "&view=room" : ""}`)}
          >
            <option value="">All practitioners</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="layout-filter">Lay out by</Label>
          <NativeSelect
            id="layout-filter"
            value={byRoom ? "room" : "practitioner"}
            onChange={(e) => router.push(pageHref(e.target.value as "practitioner" | "room"))}
          >
            <option value="practitioner">Practitioner</option>
            <option value="room">Room</option>
          </NativeSelect>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-body text-muted-foreground">{byRoom && rooms.length === 0 ? "No rooms set up at this facility." : "No appointments on this day."}</p>
      ) : null}
      {truncated ? (
        <p role="status" className="text-table text-warning-foreground">
          Showing the first 100 appointments. Filter by practitioner to see the rest.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
              <span className="ml-auto text-meta text-muted-foreground">
                {g.items.length === 0 ? "nothing booked" : `${g.items.filter((a) => a.status !== "cancelled").length} scheduled`}
              </span>
            </CardHeader>
            <ul className="divide-y px-3">
              {g.items.length === 0 ? <li className="py-2 text-meta text-muted-foreground">Free all day.</li> : null}
              {g.items.map((a) => {
                const actions = appointmentActions(a, {
                  now,
                  isToday,
                  canManage,
                  canCheckIn,
                  online: visitTypeMap.get(a.visitTypeId)?.modality === "telemedicine",
                });
                return (
                  <li key={a.id} className="py-0.5">
                    <AppointmentCard
                      appointment={toAppointment(a, practitionerMap, visitTypeMap)}
                      action={
                        <span className="flex shrink-0 items-center gap-1">
                          {canOpenRecord ? (
                            <Button asChild variant="ghost" size="xs">
                              <Link href={`/patients/${a.patientId}`}>Record</Link>
                            </Button>
                          ) : null}
                          {actions.map((action) => (
                            <ActionButton key={action} action={action} disabled={pending} onClick={() => act(a, action)} />
                          ))}
                        </span>
                      }
                    />
                    {rescheduling === a.id ? (
                      <RescheduleForm
                        appointment={a}
                        facilityId={facilityId}
                        timeZone={timeZone}
                        practitioners={practitioners}
                        pending={pending}
                        run={run}
                        onClose={() => setRescheduling(null)}
                      />
                    ) : null}
                    {cancelling === a.id ? (
                      <form
                        className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-warning/40 p-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run(
                            () => cancelAppointment({ appointmentId: a.id, version: a.version, reason: reason.trim() }),
                            `Cancelled ${a.patient?.displayName ?? "appointment"}`,
                          );
                        }}
                      >
                        <div className="grid min-w-60 flex-1 gap-1">
                          <Label htmlFor={`cancel-${a.id}`}>Reason for cancelling *</Label>
                          <Input
                            id={`cancel-${a.id}`}
                            autoFocus
                            value={reason}
                            maxLength={500}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Patient called to cancel"
                          />
                        </div>
                        <Button type="submit" variant="destructive" size="sm" disabled={pending || reason.trim().length < 3}>
                          Cancel appointment
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(null)}>
                          Keep
                        </Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

const ACTION_META: Record<AppointmentAction, { label: string; icon: React.ComponentType; variant: "default" | "outline" | "ghost" }> = {
  check_in: { label: "Check in", icon: LogInIcon, variant: "default" },
  confirm: { label: "Confirm", icon: CheckIcon, variant: "outline" },
  no_show: { label: "No-show", icon: UserXIcon, variant: "ghost" },
  reschedule: { label: "Move", icon: CalendarClockIcon, variant: "ghost" },
  cancel: { label: "Cancel", icon: CalendarXIcon, variant: "ghost" },
};

function ActionButton({ action, disabled, onClick }: { action: AppointmentAction; disabled: boolean; onClick: () => void }) {
  const { label, icon: Icon, variant } = ACTION_META[action];
  return (
    <Button variant={variant} size="xs" disabled={disabled} onClick={onClick}>
      <Icon /> {label}
    </Button>
  );
}
