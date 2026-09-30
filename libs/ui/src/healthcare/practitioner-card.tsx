import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../primitives/avatar";
import { Badge } from "../primitives/badge";
import { CheckCircle2Icon, MinusCircleIcon } from "lucide-react";
import { cn } from "../lib/utils";

/** A practitioner as a card: photo (or initials), availability (icon + text, never colour alone), specialty, hours and actions. */
export function PractitionerCard({
  name,
  specialty,
  hours,
  available,
  availableLabel = "Available",
  unavailableLabel = "Unavailable",
  photoUrl,
  actions,
  className,
}: {
  name: string;
  specialty?: string | null;
  hours?: string | null;
  available: boolean;
  availableLabel?: string;
  unavailableLabel?: string;
  photoUrl?: string | null;
  actions?: React.ReactNode;
  className?: string;
}) {
  const initials = name
    .replace(/^dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <article className={cn("flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-xs", className)} aria-label={name}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="truncate text-section font-semibold">{name}</h3>
        <Badge variant={available ? "success" : "neutral"}>
          {available ? <CheckCircle2Icon aria-hidden /> : <MinusCircleIcon aria-hidden />}
          {available ? availableLabel : unavailableLabel}
        </Badge>
      </header>
      <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-primary-subtle">
        <Avatar className="size-24 text-page-lg">
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback className="bg-card">{initials}</AvatarFallback>
        </Avatar>
      </div>
      <div className="rounded-lg bg-muted/60 p-3 text-center">
        <p className="text-body font-semibold text-primary-deep">{specialty || "General practice"}</p>
        {hours ? <p className="mt-0.5 text-meta text-muted-foreground">{hours}</p> : null}
      </div>
      {actions ? <footer className="flex items-center gap-2">{actions}</footer> : null}
    </article>
  );
}
