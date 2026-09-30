import * as React from "react";
import { BadgeCheckIcon, BadgeXIcon, DropletIcon, EyeOffIcon, PhoneIcon } from "lucide-react";
import { Badge } from "../primitives/badge";
import type { Patient } from "@healthcare/domain";
import { ageFrom, clinicalDate, fullName, sexLabel } from "../lib/format";
import { cn } from "../lib/utils";
import { AllergyList } from "./allergy-badge";
import { PatientAvatar } from "./patient-avatar";
import { PatientIdentifier } from "./patient-identifier";

export interface PatientHeaderProps {
  patient: Patient;
  /** `compact` is a single line for workspaces; `full` is the Patient 360 banner. */
  variant?: "compact" | "full";
  /** Right-aligned slot for context (visit info, actions). */
  aside?: React.ReactNode;
  /**
   * False when no allergy record exists for this patient yet. Shows "Allergies not recorded"
   * instead of "No known allergies" — an empty list must never read as "no allergies".
   */
  allergiesRecorded?: boolean;
  /** True when the viewer may not see clinical data: shows "Allergies: no access" instead of any allergy statement. */
  allergiesHidden?: boolean;
  /** Extra facts on the banner's detail line (full variant), e.g. a masked PhilHealth PIN or alert badges. */
  details?: React.ReactNode;
  className?: string;
}

/**
 * The patient banner. Identity + allergies are always visible together at the
 * top of any patient-context screen (a core patient-safety pattern).
 */
export function PatientHeader({ patient, variant = "full", aside, allergiesRecorded = true, allergiesHidden = false, details, className }: PatientHeaderProps) {
  const age = ageFrom(patient.birthDate);
  const name = fullName(patient);

  if (variant === "compact") {
    return (
      <header className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card px-4 py-2", className)} aria-label="Patient banner">
        <div className="flex items-center gap-2">
          <PatientAvatar patient={patient} size="sm" />
          <span className="text-section font-semibold">{name}</span>
          <span className="tabular text-body text-muted-foreground">
            {age} {sexLabel(patient.sex, true)}
          </span>
          <PatientIdentifier mrn={patient.mrn} />
        </div>
        {allergiesHidden ? <AllergiesHidden /> : <AllergyList allergies={patient.allergies} recorded={allergiesRecorded} />}
        {patient.bloodType ? <BloodType value={patient.bloodType} /> : null}
        {aside ? <div className="ml-auto flex items-center gap-2">{aside}</div> : null}
      </header>
    );
  }

  return (
    <header className={cn("flex flex-wrap items-start gap-4 border-b bg-card px-4 py-4", className)} aria-label="Patient banner">
      <PatientAvatar patient={patient} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-page font-semibold tracking-tight">{name}</h1>
          <span className="tabular text-body text-muted-foreground">
            {age} years • {sexLabel(patient.sex)}
          </span>
          <PatientIdentifier mrn={patient.mrn} />
        </div>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-table">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Allergies</dt>
            <dd>{allergiesHidden ? <AllergiesHidden /> : <AllergyList allergies={patient.allergies} recorded={allergiesRecorded} />}</dd>
          </div>
          {patient.phone ? (
            <div className="flex items-center gap-1 text-muted-foreground">
              <dt>
                <PhoneIcon className="size-3.5" aria-label="Phone" />
              </dt>
              <dd className="tabular">{patient.phone}</dd>
            </div>
          ) : null}
          {details}
        </dl>
        <dl className="mt-1 flex flex-wrap gap-2" aria-label="Key facts">
          <FactTile label="Age & sex" value={`${age} / ${sexLabel(patient.sex)}`} />
          <FactTile label="Date of birth" value={clinicalDate(`${patient.birthDate}T12:00:00Z`)} />
          {patient.bloodType ? (
            <FactTile label="Blood type" value={patient.bloodType} icon={<DropletIcon className="size-3.5 text-danger" aria-hidden />} />
          ) : null}
          {patient.philHealth ? (
            <FactTile
              label="PhilHealth"
              value={patient.philHealth.verified ? "Verified" : "Unverified"}
              icon={
                patient.philHealth.verified ? (
                  <BadgeCheckIcon className="size-3.5 text-success-foreground" aria-hidden />
                ) : (
                  <BadgeXIcon className="size-3.5 text-warning-foreground" aria-hidden />
                )
              }
            />
          ) : null}
        </dl>
      </div>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </header>
  );
}

function FactTile({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/60 px-3 py-1.5">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-table font-semibold">
        {icon}
        {value}
      </dd>
    </div>
  );
}

function AllergiesHidden() {
  return (
    <Badge variant="neutral">
      <EyeOffIcon aria-hidden /> Allergies: no access
    </Badge>
  );
}

function BloodType({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-table">
      <DropletIcon className="size-3.5 text-danger" aria-hidden />
      <span className="text-muted-foreground">Blood type</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
