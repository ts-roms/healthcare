import * as React from "react";
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";
import type { Allergy } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip";
import { severitySpec } from "./status";

/** Allergy chip. Always shows the warning icon + substance text; severity sets the tone. */
export function AllergyBadge({ allergy, className }: { allergy: Allergy; className?: string }) {
  const spec = severitySpec[allergy.severity];
  const variant = spec.variant === "critical" ? "critical" : allergy.severity === "mild" ? "warning" : "danger";
  const badge = (
    <Badge variant={variant} className={className}>
      <AlertTriangleIcon aria-hidden />
      <span>
        <span className="sr-only">Allergy: </span>
        {allergy.substance}
      </span>
    </Badge>
  );
  if (!allergy.reaction) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        {spec.label} — {allergy.reaction}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Allergy summary. An empty list renders an explicit "No known allergies"
 * — absence of a badge must never be mistaken for "not recorded".
 */
export function AllergyList({ allergies, recorded = true, className }: { allergies: Allergy[]; recorded?: boolean; className?: string }) {
  if (!recorded) {
    return (
      <Badge variant="warning" className={className}>
        <AlertTriangleIcon aria-hidden /> Allergies not recorded — ask the patient
      </Badge>
    );
  }
  if (allergies.length === 0) {
    return (
      <Badge variant="success" className={className}>
        <ShieldCheckIcon aria-hidden /> No known allergies
      </Badge>
    );
  }
  return (
    <span className={className}>
      <span className="inline-flex flex-wrap gap-1">
        {allergies.map((a) => (
          <AllergyBadge key={a.id} allergy={a} />
        ))}
      </span>
    </span>
  );
}
