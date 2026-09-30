"use client";

import * as React from "react";
import { ImageIcon } from "lucide-react";
import { toothLabel } from "@healthcare/domain";
import { Button } from "@healthcare/ui/primitives";
import type { PortalDentalImage, PortalDentalRecord } from "@/lib/api/types";
import { IMAGE_KIND_TEXT } from "@/lib/dental";
import { formatCalendarDate } from "@/lib/greeting";
import { openDentalImage } from "./actions";

/** X-rays and photos the dentist shared. Each opens through a short-lived link (the clinic sees that it was opened). */
export function DentalImages({ images, notation }: { images: PortalDentalImage[]; notation: PortalDentalRecord["notation"] }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const open = (imageId: string) => {
    // Open the tab now (a later window.open would be blocked), then point it at the link.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      setError(null);
      const result = await openDentalImage(imageId);
      if (result.ok) {
        if (tab) tab.location.href = result.data.url;
        else window.location.assign(result.data.url);
      } else {
        tab?.close();
        setError(result.message);
      }
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {images.map((image) => (
          <li key={image.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <ImageIcon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold">{IMAGE_KIND_TEXT[image.kind]}</span>
              <span className="text-meta text-muted-foreground">
                Taken {formatCalendarDate(image.takenOn)}
                {image.teeth.length ? ` · tooth ${image.teeth.map((t) => toothLabel(t, notation)).join(", ")}` : ""}
                {image.facilityName ? ` · ${image.facilityName}` : ""}
              </span>
            </span>
            <Button type="button" disabled={pending} onClick={() => open(image.id)} variant="outline" className="h-9 shrink-0 px-3">
              Open
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
