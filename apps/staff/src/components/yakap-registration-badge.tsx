import { CircleCheckIcon, CircleHelpIcon, CircleMinusIcon, ClockIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { YakapRegistrationStatus } from "@/lib/api/types";

const STATUS: Record<YakapRegistrationStatus, { label: string; variant: "success" | "warning" | "info" | "neutral"; icon: typeof ClockIcon }> = {
  registered: { label: "Registered", variant: "success", icon: CircleCheckIcon },
  not_registered: { label: "Not registered", variant: "neutral", icon: CircleMinusIcon },
  pending: { label: "Pending", variant: "info", icon: ClockIcon },
  unknown: { label: "Unknown", variant: "warning", icon: CircleHelpIcon },
};

export const YAKAP_REGISTRATION_LABEL: Record<YakapRegistrationStatus, string> = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<YakapRegistrationStatus, string>;

/** PhilHealth's YAKAP registration answer as recorded: colour, icon and text (never colour alone). */
export function YakapRegistrationBadge({ status }: { status: YakapRegistrationStatus }) {
  const { label, variant, icon: Icon } = STATUS[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}
