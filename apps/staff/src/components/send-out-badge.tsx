import { BanIcon, BuildingIcon, CircleCheckIcon, CircleXIcon, ClockAlertIcon, PackageIcon, TruckIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { LabSendOutStatus } from "@/lib/api/types";
import { SEND_OUT_STATUS_LABEL, sendOutTone } from "@/lib/lab-mapping";

const ICON: Record<LabSendOutStatus, typeof TruckIcon> = {
  prepared: PackageIcon,
  dispatched: TruckIcon,
  results_received: CircleCheckIcon,
  rejected: CircleXIcon,
  cancelled: BanIcon,
};

/** A send-out's status: colour, icon and text (never colour alone). Overdue send-outs say so. */
export function SendOutBadge({ status, overdue = false, className }: { status: LabSendOutStatus; overdue?: boolean; className?: string }) {
  const Icon = overdue && status === "dispatched" ? ClockAlertIcon : ICON[status];
  return (
    <Badge variant={sendOutTone({ status, overdue })} className={className}>
      <Icon aria-hidden /> {SEND_OUT_STATUS_LABEL[status]}
      {overdue && status === "dispatched" ? " · overdue" : ""}
    </Badge>
  );
}

/** "Performed by <reference laboratory>" for a result the facility did not perform itself. */
export function PerformedBy({ laboratory, className }: { laboratory: string | null | undefined; className?: string }) {
  if (!laboratory) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-meta text-muted-foreground ${className ?? ""}`}>
      <BuildingIcon className="size-3.5" aria-hidden /> Performed by {laboratory}
    </span>
  );
}
