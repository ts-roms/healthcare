import Link from "next/link";
import { ClockIcon, EyeOffIcon } from "lucide-react";
import type { Patient } from "@healthcare/domain";
import { AllergyList, ageFrom, fullName, sexLabel } from "@healthcare/ui/healthcare";
import { Badge } from "@healthcare/ui/primitives";
import { WAIT_LONG_MINUTES, WAIT_WARN_MINUTES } from "@/lib/clinic-mapping";

/**
 * The top of the triage screen: the ticket, who the patient is, their allergies (always beside the name), how long they have
 * waited and how they arrived. Waiting time is colour plus a clock icon plus the minutes, never colour alone.
 */
export function TriageHeader({
  ticket,
  patient,
  patientHref,
  allergiesHidden,
  allergiesRecorded,
  waitingMinutes,
  arrivalMode,
}: {
  ticket: string;
  patient: Patient;
  patientHref: string;
  allergiesHidden: boolean;
  allergiesRecorded: boolean;
  waitingMinutes: number;
  arrivalMode: "walk_in" | "appointment";
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b bg-card px-4 py-4 sm:px-6" aria-label="Patient banner">
      <div className="rounded-xl bg-primary-subtle px-3 py-2 text-center text-primary">
        <p className="text-meta font-semibold tracking-wide uppercase">Triage</p>
        <p className="font-mono text-xl leading-tight font-semibold">{ticket}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-page font-semibold tracking-tight">{fullName(patient)}</h1>
          <span className="tabular text-table text-muted-foreground">
            {sexLabel(patient.sex)} · {ageFrom(patient.birthDate)} y · {patient.mrn}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allergiesHidden ? (
            <Badge variant="neutral">
              <EyeOffIcon aria-hidden /> Allergies: no access
            </Badge>
          ) : (
            <AllergyList allergies={patient.allergies} recorded={allergiesRecorded} />
          )}
          <Badge variant={waitingMinutes >= WAIT_LONG_MINUTES ? "danger" : waitingMinutes >= WAIT_WARN_MINUTES ? "warning" : "neutral"}>
            <ClockIcon aria-hidden /> Waiting {waitingMinutes} min
          </Badge>
          <Badge variant="neutral">{arrivalMode === "walk_in" ? "Walk-in" : "Appointment"}</Badge>
        </div>
      </div>
      <Link href={patientHref} className="text-table font-medium text-primary underline underline-offset-2">
        Open patient record
      </Link>
    </header>
  );
}
