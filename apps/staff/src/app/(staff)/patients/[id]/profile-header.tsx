import Link from "next/link";
import { CalendarPlusIcon, ChevronRightIcon, EyeOffIcon, LogInIcon, PhoneIcon, ReceiptIcon, UsersRoundIcon } from "lucide-react";
import { AllergyList, ageFrom, PatientAvatar, PatientIdentifier, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button } from "@healthcare/ui/primitives";
import type { Patient } from "@healthcare/domain";
import type { QueueVisit } from "@/lib/api/types";
import { visitStatusLabel } from "@/lib/clinic-mapping";
import { StartConsultationButton } from "@/app/(staff)/clinic/encounters/start-consultation-button";
import { ProfileMoreMenu, type MoreMenuItem } from "./profile-more-menu";

/**
 * The top of the patient record: who this is, whether they are in today's queue, their allergies (always beside the name), and
 * the actions used at the desk. The rarer ones sit behind **More**. Each action is shown only when the viewer may use it; the
 * API checks again.
 */
export function ProfileHeader({
  patient,
  statusLabel,
  allergiesHidden,
  allergiesRecorded,
  todaysVisit,
  canStartConsultation,
  checkInHref,
  bookHref,
  billingHref,
  more,
}: {
  patient: Patient;
  /** Shown beside the name when the record is not active (merged, deceased, inactive). */
  statusLabel: string | null;
  allergiesHidden: boolean;
  allergiesRecorded: boolean;
  /** Today's open queue visit at the selected facility, if any. */
  todaysVisit: Pick<QueueVisit, "id" | "status" | "queueNumber" | "ticket" | "modality" | "appointmentId"> | null;
  canStartConsultation: boolean;
  /** Walk-in check-in, offered when the patient is not in today's queue. */
  checkInHref?: string;
  bookHref?: string;
  billingHref?: string;
  more: MoreMenuItem[];
}) {
  const age = ageFrom(patient.birthDate);
  return (
    <header className="flex flex-col gap-3" aria-label="Patient banner">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-table text-muted-foreground">
          <li>
            <Link
              href="/patients"
              className="rounded-sm hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Patients
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRightIcon className="size-3.5" />
          </li>
          <li aria-current="page">
            {patient.givenName} {patient.familyName}
          </li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <PatientAvatar patient={patient} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-page font-semibold tracking-tight">
              {patient.givenName} {patient.familyName}
            </h1>
            <PatientIdentifier mrn={patient.mrn} />
            {statusLabel ? <Badge variant="warning">{statusLabel}</Badge> : <Badge variant="success">Active</Badge>}
            {todaysVisit ? (
              <Link href="/queue" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <Badge variant="info">
                  <UsersRoundIcon aria-hidden /> In queue · {visitStatusLabel(todaysVisit.status)} · #{todaysVisit.queueNumber}
                </Badge>
              </Link>
            ) : null}
          </div>
          <p className="tabular flex flex-wrap items-center gap-x-3 text-body text-muted-foreground">
            <span>
              {age} years · {sexLabel(patient.sex)}
            </span>
            {patient.phone ? (
              <span className="inline-flex items-center gap-1">
                <PhoneIcon className="size-3.5" aria-label="Phone" /> {patient.phone}
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="sr-only">Allergies</span>
            {allergiesHidden ? (
              <Badge variant="neutral">
                <EyeOffIcon aria-hidden /> Allergies: no access
              </Badge>
            ) : (
              <AllergyList allergies={patient.allergies} recorded={allergiesRecorded} />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProfileMoreMenu items={more} />
          {billingHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={billingHref}>
                <ReceiptIcon /> Billing
              </Link>
            </Button>
          ) : null}
          {bookHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={bookHref}>
                <CalendarPlusIcon /> Book appointment
              </Link>
            </Button>
          ) : null}
          {todaysVisit && canStartConsultation ? <StartConsultationButton visit={todaysVisit} /> : null}
          {!todaysVisit && checkInHref ? (
            <Button asChild size="sm">
              <Link href={checkInHref}>
                <LogInIcon /> Check in (walk-in)
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
