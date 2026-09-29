"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MonitorIcon, StethoscopeIcon } from "lucide-react";
import { Button, toast } from "@healthcare/ui/primitives";
import type { QueueVisit } from "@/lib/api/types";
import { startEncounter } from "./actions";

/**
 * Starts the consultation for a queue visit and opens the encounter workspace. An online visit is started from
 * Telemedicine instead, which also brings the patient from the MyHealth waiting room into the call.
 */
export function StartConsultationButton({ visit, size = "sm" }: { visit: Pick<QueueVisit, "id" | "modality" | "appointmentId">; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  if (visit.modality === "telemedicine" && visit.appointmentId) {
    return (
      <Button asChild size={size}>
        <Link href={`/telemedicine/${visit.appointmentId}`}>
          <MonitorIcon /> Open in Telemedicine
        </Link>
      </Button>
    );
  }
  const visitId = visit.id;
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await startEncounter({ visitId });
          if (result.ok) {
            router.push(`/clinic/encounters/${result.data.id}`);
            return;
          }
          toast.error(result.message);
          router.refresh();
        })
      }
    >
      <StethoscopeIcon /> {pending ? "Starting…" : "Start consultation"}
    </Button>
  );
}
