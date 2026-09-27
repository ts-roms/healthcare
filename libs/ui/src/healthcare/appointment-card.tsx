import * as React from "react";
import { MonitorIcon, UserIcon } from "lucide-react";
import type { Appointment, AppointmentStatus } from "@healthcare/domain";
import { Badge, type BadgeProps } from "../primitives/badge";
import { clinicalTime, relativeDay } from "../lib/format";
import { cn } from "../lib/utils";

const statusMeta: Record<AppointmentStatus, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  booked: { label: "Booked", variant: "neutral" },
  arrived: { label: "Arrived", variant: "info" },
  "in-progress": { label: "In progress", variant: "teal" },
  completed: { label: "Completed", variant: "success" },
  "no-show": { label: "No-show", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const m = statusMeta[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

/**
 * `row` is a one-line schedule entry for staff lists; `card` is the
 * larger, patient-facing variant.
 */
export function AppointmentCard({
  appointment,
  variant = "row",
  showPatient = true,
  action,
  className,
}: {
  appointment: Appointment;
  variant?: "row" | "card";
  showPatient?: boolean;
  action?: React.ReactNode;
  className?: string;
}) {
  const ModeIcon = appointment.mode === "online" ? MonitorIcon : UserIcon;
  if (variant === "card") {
    return (
      <article className={cn("flex items-center gap-3 rounded-xl border bg-card p-4", className)}>
        <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-primary-subtle py-2 text-primary">
          <span className="text-meta font-semibold uppercase">{relativeDay(appointment.start)}</span>
          <span className="tabular text-section font-bold">{clinicalTime(appointment.start)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-section font-semibold">{appointment.provider}</p>
          <p className="flex items-center gap-1 text-body text-muted-foreground">
            <ModeIcon className="size-3.5" aria-hidden />
            {appointment.mode === "online" ? "Online consultation" : "Clinic visit"}
            {appointment.reason ? ` · ${appointment.reason}` : ""}
          </p>
        </div>
        {action}
      </article>
    );
  }
  return (
    <div className={cn("flex items-center gap-3 py-1.5", className)}>
      <span className="tabular w-12 shrink-0 font-semibold">{clinicalTime(appointment.start)}</span>
      <ModeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={appointment.mode === "online" ? "Online" : "In person"} />
      <div className="min-w-0 flex-1 truncate">
        {showPatient ? <span className="font-medium">{appointment.patientName}</span> : <span className="font-medium">{appointment.provider}</span>}
        {appointment.reason ? <span className="text-muted-foreground"> · {appointment.reason}</span> : null}
      </div>
      <AppointmentStatusBadge status={appointment.status} />
      {action}
    </div>
  );
}
