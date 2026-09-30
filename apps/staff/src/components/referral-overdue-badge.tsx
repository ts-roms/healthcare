import { ClockAlertIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";

/**
 * A referral still waiting for the recipient past the organization's threshold (clinic referral settings). Icon and
 * text, never colour alone; nothing is shown while the flag is off or the referral is not overdue.
 */
export function ReferralOverdueBadge({ overdue, className }: { overdue: boolean; className?: string }) {
  if (!overdue) return null;
  return (
    <Badge variant="warning" className={className} title="No answer or reply yet, past your organization's follow-up threshold">
      <ClockAlertIcon aria-hidden /> Overdue
    </Badge>
  );
}
