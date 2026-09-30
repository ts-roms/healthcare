import { BanIcon, CircleCheckIcon, CircleXIcon, ClockIcon, MinusCircleIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { NotificationStatus } from "@/lib/api/types";
import { statusView, suppressionReasonText } from "@/lib/communications";

const STATUS_ICON = { success: CircleCheckIcon, info: ClockIcon, warning: BanIcon, danger: CircleXIcon, neutral: MinusCircleIcon } as const;

/** A delivery status: colour + icon + text. */
export function DeliveryStatus({ status, reason }: { status: NotificationStatus; reason?: string | null }) {
  const view = statusView(status);
  const Icon = STATUS_ICON[view.tone];
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant={view.tone}>
        <Icon aria-hidden /> {view.label}
      </Badge>
      {status === "suppressed" ? <span className="text-meta text-muted-foreground">{suppressionReasonText(reason ?? null)}</span> : null}
    </span>
  );
}
