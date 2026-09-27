import * as React from "react";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  ClockIcon,
  FlaskConicalIcon,
  LoaderIcon,
  SearchCheckIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { LabFlag, LabOrderStatus, Severity } from "@healthcare/domain";
import { Badge, type BadgeProps } from "../primitives/badge";
import { cn } from "../lib/utils";

/**
 * Status vocabulary. Every clinical status resolves to (colour, icon, label)
 * so meaning never depends on colour alone.
 */
export interface StatusSpec {
  label: string;
  icon: LucideIcon;
  variant: NonNullable<BadgeProps["variant"]>;
}

export const labFlagSpec: Record<LabFlag, StatusSpec> = {
  normal: { label: "Normal", icon: CheckCircle2Icon, variant: "neutral" },
  low: { label: "Low", icon: ArrowDownIcon, variant: "warning" },
  high: { label: "High", icon: ArrowUpIcon, variant: "warning" },
  abnormal: { label: "Abnormal", icon: AlertTriangleIcon, variant: "warning" },
  "critical-low": { label: "Critical low", icon: AlertOctagonIcon, variant: "critical" },
  "critical-high": { label: "Critical high", icon: AlertOctagonIcon, variant: "critical" },
};

export const labOrderStatusSpec: Record<LabOrderStatus, StatusSpec> = {
  ordered: { label: "Ordered", icon: CircleDashedIcon, variant: "neutral" },
  collected: { label: "Collected", icon: FlaskConicalIcon, variant: "info" },
  received: { label: "Pending", icon: ClockIcon, variant: "info" },
  processing: { label: "Processing", icon: LoaderIcon, variant: "info" },
  "awaiting-verification": { label: "To verify", icon: SearchCheckIcon, variant: "warning" },
  review: { label: "Review", icon: AlertTriangleIcon, variant: "warning" },
  verified: { label: "Verified", icon: CheckCircle2Icon, variant: "success" },
  rejected: { label: "Rejected", icon: XCircleIcon, variant: "danger" },
};

export const severitySpec: Record<Severity, StatusSpec> = {
  mild: { label: "Mild", icon: CircleDotIcon, variant: "warning" },
  moderate: { label: "Moderate", icon: AlertTriangleIcon, variant: "warning" },
  severe: { label: "Severe", icon: AlertTriangleIcon, variant: "danger" },
  "life-threatening": { label: "Life-threatening", icon: AlertOctagonIcon, variant: "critical" },
};

export function isCriticalFlag(flag: LabFlag) {
  return flag === "critical-high" || flag === "critical-low";
}

export function StatusBadge({ spec, className, hideLabel }: { spec: StatusSpec; className?: string; hideLabel?: boolean }) {
  const Icon = spec.icon;
  return (
    <Badge variant={spec.variant} className={className} title={hideLabel ? spec.label : undefined}>
      <Icon aria-hidden />
      {hideLabel ? <span className="sr-only">{spec.label}</span> : spec.label}
    </Badge>
  );
}

export function LabFlagBadge({ flag, className }: { flag: LabFlag; className?: string }) {
  return <StatusBadge spec={labFlagSpec[flag]} className={className} />;
}

/** Plain-text flag for dense tables: icon + short label, coloured text only. */
export function LabFlagText({ flag, className }: { flag: LabFlag; className?: string }) {
  const spec = labFlagSpec[flag];
  const Icon = spec.icon;
  const tone =
    spec.variant === "critical"
      ? "font-semibold text-critical dark:text-danger"
      : spec.variant === "warning"
        ? "font-medium text-warning-foreground"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1", tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      {spec.label}
    </span>
  );
}
