import { CalendarIcon, MapPinIcon, VideoIcon } from "lucide-react";
import type { PortalAppointment } from "@/lib/api/types";
import { APPOINTMENT_STATUS, visitTime } from "@/lib/records";

export function VisitCard({ visit }: { visit: PortalAppointment }) {
  const Icon = visit.modality === "telemedicine" ? VideoIcon : CalendarIcon;
  const inactive = visit.status === "cancelled" || visit.status === "no_show";
  return (
    <div className={`flex gap-3 rounded-xl border bg-card p-4 ${inactive ? "opacity-70" : ""}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{visitTime(visit)}</span>
          <span className="text-meta font-medium text-muted-foreground">{APPOINTMENT_STATUS[visit.status]}</span>
        </p>
        <p className="text-body">
          {visit.visitType} with {visit.practitionerName}
        </p>
        <p className="flex items-center gap-1 text-meta text-muted-foreground">
          <MapPinIcon className="size-3.5" aria-hidden /> {visit.modality === "telemedicine" ? "Online" : visit.facilityName}
        </p>
      </div>
    </div>
  );
}
