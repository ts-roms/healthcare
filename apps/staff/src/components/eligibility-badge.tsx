import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { EligibilityCheck } from "@/lib/api/types";

const STATUS: Record<EligibilityCheck["status"], { label: string; variant: "success" | "danger" | "warning" | "info" | "neutral"; icon: typeof ClockIcon }> = {
  eligible: { label: "Eligible", variant: "success", icon: CircleCheckIcon },
  not_eligible: { label: "Not eligible", variant: "danger", icon: CircleXIcon },
  undetermined: { label: "Undetermined", variant: "warning", icon: CircleHelpIcon },
  queued: { label: "Checking", variant: "info", icon: ClockIcon },
  failed: { label: "No answer", variant: "neutral", icon: TriangleAlertIcon },
};

/** Eligibility answer: colour, icon and text (never colour alone). */
export function EligibilityBadge({ status }: { status: EligibilityCheck["status"] }) {
  const { label, variant, icon: Icon } = STATUS[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}
