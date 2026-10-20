"use client";

import * as React from "react";
import { AlertOctagonIcon, CheckCircle2Icon, CircleDotIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { LabNonconformance, NonconformanceCategory, NonconformanceSeverity } from "@/lib/api/types";

export const CATEGORY_LABEL: Record<NonconformanceCategory, string> = {
  pre_analytical: "Pre-analytical",
  analytical: "Analytical",
  post_analytical: "Post-analytical",
  equipment: "Equipment",
  temperature_excursion: "Temperature excursion",
  qc_failure: "QC failure",
  eqa_failure: "EQA failure",
  safety: "Safety",
  complaint: "Complaint",
  other: "Other",
};

export const SEVERITY_LABEL: Record<NonconformanceSeverity, string> = { minor: "Minor", major: "Major", critical: "Critical" };

/** Status as colour + icon + text. */
export function NonconformanceStatusBadge({ status }: { status: LabNonconformance["status"] }) {
  if (status === "closed")
    return (
      <Badge variant="success">
        <CheckCircle2Icon aria-hidden /> Closed
      </Badge>
    );
  if (status === "investigating")
    return (
      <Badge variant="info">
        <SearchIcon aria-hidden /> Investigating
      </Badge>
    );
  return (
    <Badge variant="warning">
      <CircleDotIcon aria-hidden /> Open
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: NonconformanceSeverity }) {
  const Icon = severity === "critical" ? AlertOctagonIcon : TriangleAlertIcon;
  return (
    <Badge variant={severity === "critical" ? "critical" : severity === "major" ? "danger" : "neutral"}>
      <Icon aria-hidden /> {SEVERITY_LABEL[severity]}
    </Badge>
  );
}
