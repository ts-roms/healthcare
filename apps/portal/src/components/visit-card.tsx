import Link from "next/link";
import { CalendarIcon, ChevronRightIcon, MapPinIcon, PencilIcon, VideoIcon } from "lucide-react";
import type { PortalAppointment } from "@/lib/api/types";
import { APPOINTMENT_STATUS, visitTime } from "@/lib/records";

export function VisitCard({ visit, upcoming = false }: { visit: PortalAppointment; upcoming?: boolean }) {
  const Icon = visit.modality === "telemedicine" ? VideoIcon : CalendarIcon;
  const inactive = visit.status === "cancelled" || visit.status === "no_show";
  // Open online consultations link to their page: questions, waiting room and video.
  const joinable = visit.modality === "telemedicine" && upcoming && ["booked", "confirmed", "checked_in"].includes(visit.status);
  const card = <Card visit={visit} icon={Icon} inactive={inactive} online={joinable} />;
  const body = joinable ? (
    <Link href={`/consultations/${visit.id}`} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {card}
    </Link>
  ) : (
    card
  );
  if (!upcoming || !(visit.canCancel || visit.canReschedule)) return body;
  return (
    <div className="flex flex-col gap-1">
      {body}
      <Link href={`/appointments/${visit.id}`} className="inline-flex items-center gap-1 self-end px-1 text-meta font-medium text-primary hover:underline">
        <PencilIcon className="size-3.5" aria-hidden /> {visit.canReschedule ? "Change or cancel" : "Cancel"}
      </Link>
    </div>
  );
}

function Card({ visit, icon: Icon, inactive, online }: { visit: PortalAppointment; icon: typeof VideoIcon; inactive: boolean; online: boolean }) {
  return (
    <div className={`flex gap-3 rounded-xl border bg-card p-4 ${inactive ? "opacity-70" : ""} ${online ? "shadow-xs transition-shadow hover:shadow-md" : ""}`}>
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
        {online ? <p className="text-meta font-medium text-primary">Answer the questions and join from here</p> : null}
      </div>
      {online ? <ChevronRightIcon className="size-5 shrink-0 self-center text-muted-foreground" aria-hidden /> : null}
    </div>
  );
}
