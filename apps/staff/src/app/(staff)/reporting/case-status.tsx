import { BanIcon, CheckCircle2Icon, ClockIcon, HistoryIcon, SendIcon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { CaseReportStatus } from "@/lib/api/types";

const SPEC: Record<CaseReportStatus, { label: string; variant: "warning" | "info" | "success" | "danger" | "neutral"; icon: typeof ClockIcon }> = {
  pending_review: { label: "To review", variant: "warning", icon: ClockIcon },
  queued: { label: "Sending", variant: "info", icon: SendIcon },
  reported: { label: "Reported", variant: "success", icon: CheckCircle2Icon },
  rejected: { label: "Rejected", variant: "danger", icon: XCircleIcon },
  failed: { label: "Not sent", variant: "danger", icon: TriangleAlertIcon },
  dismissed: { label: "Dismissed", variant: "neutral", icon: BanIcon },
};

/** Case report status: colour, icon and text (never colour alone). */
export function CaseStatus({ status }: { status: CaseReportStatus }) {
  const { label, variant, icon: Icon } = SPEC[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

/** Marks a case report opened by a check of earlier diagnoses (the diagnosis was recorded before its rule existed). */
export function FoundByCheck() {
  return (
    <Badge variant="neutral" title="Opened by a check of earlier diagnoses: the diagnosis was recorded before the rule was added">
      <HistoryIcon aria-hidden /> Earlier diagnosis
    </Badge>
  );
}
