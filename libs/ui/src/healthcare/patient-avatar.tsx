import * as React from "react";
import type { Patient } from "@healthcare/domain";
import { Avatar, AvatarFallback, AvatarImage } from "../primitives/avatar";
import { cn } from "../lib/utils";

const sizes = { sm: "size-7 text-meta", md: "size-9 text-table", lg: "size-12 text-section" } as const;

export function PatientAvatar({
  patient,
  size = "md",
  className,
}: {
  patient: Pick<Patient, "givenName" | "familyName" | "photoUrl">;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const initials = `${patient.givenName[0] ?? ""}${patient.familyName[0] ?? ""}`.toUpperCase();
  return (
    <Avatar className={cn(sizes[size], className)}>
      {patient.photoUrl ? <AvatarImage src={patient.photoUrl} alt="" /> : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
