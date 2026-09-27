"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StethoscopeIcon } from "lucide-react";
import { Button, toast } from "@healthcare/ui/primitives";
import { startEncounter } from "./actions";

/** Starts the consultation for a queue visit and opens the encounter workspace. */
export function StartConsultationButton({ visitId, size = "sm" }: { visitId: string; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
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
