"use client";

import { IdCardIcon, UserPlusIcon } from "lucide-react";
import { BigButton } from "../bits";
import { Frame } from "../frame";

/** PatientTypePage: "have you been here before?" — the only decision between the two paths. */
export function PatientTypePage({
  facilityName,
  onChoose,
  onBack,
  onStartOver,
}: {
  facilityName: string;
  onChoose: (kind: "existing" | "new") => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  return (
    <Frame title="Have you been here before?" facilityName={facilityName} onBack={onBack} onStartOver={onStartOver}>
      <div className="grid gap-6 sm:grid-cols-2">
        <BigButton variant="default" onClick={() => onChoose("existing")} className="min-h-56 flex-col gap-4 text-3xl whitespace-normal">
          <IdCardIcon aria-hidden className="size-16" />
          Yes, I am a patient here
        </BigButton>
        <BigButton variant="outline" onClick={() => onChoose("new")} className="min-h-56 flex-col gap-4 text-3xl whitespace-normal">
          <UserPlusIcon aria-hidden className="size-16" />
          No, this is my first visit
        </BigButton>
      </div>
    </Frame>
  );
}
