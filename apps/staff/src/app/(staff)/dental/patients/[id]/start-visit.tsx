"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlayIcon } from "lucide-react";
import { Button, Input, toast } from "@healthcare/ui/primitives";
import { startDentalVisit } from "../../actions";

/** Starts a dental visit (an encounter with the signed-in dentist) for a patient who did not come through the queue. */
export function StartVisit({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [complaint, setComplaint] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const start = () =>
    startTransition(async () => {
      const result = await startDentalVisit(patientId, complaint);
      if (result.ok) {
        toast.success("Dental visit started");
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Chief complaint"
        placeholder="Chief complaint (optional)"
        className="h-7 w-56"
        value={complaint}
        maxLength={500}
        onChange={(e) => setComplaint(e.target.value)}
      />
      <Button size="sm" onClick={start} disabled={pending}>
        <PlayIcon /> Start dental visit
      </Button>
    </span>
  );
}
