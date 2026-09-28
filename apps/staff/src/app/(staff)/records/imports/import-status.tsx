import { BanIcon, CheckCheckIcon, CheckCircle2Icon, CircleDashedIcon, ClockIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { FhirImportEntryOutcome, FhirImportStatus } from "@/lib/api/types";

type Variant = "warning" | "info" | "success" | "danger" | "neutral";

const IMPORT: Record<FhirImportStatus, { label: string; variant: Variant; icon: typeof ClockIcon }> = {
  pending_review: { label: "To review", variant: "warning", icon: ClockIcon },
  accepted: { label: "Accepted", variant: "success", icon: CheckCircle2Icon },
  partially_accepted: { label: "Partly accepted", variant: "info", icon: CheckCheckIcon },
  rejected: { label: "Rejected", variant: "danger", icon: XCircleIcon },
};

const OUTCOME: Record<FhirImportEntryOutcome, { label: string; variant: Variant; icon: typeof ClockIcon }> = {
  pending: { label: "To review", variant: "warning", icon: CircleDashedIcon },
  accepted: { label: "Accepted", variant: "success", icon: CheckCircle2Icon },
  rejected: { label: "Rejected", variant: "danger", icon: XCircleIcon },
  not_supported: { label: "Not supported for import", variant: "neutral", icon: BanIcon },
};

/** Import status: colour, icon and text (never colour alone). */
export function ImportStatus({ status }: { status: FhirImportStatus }) {
  const { label, variant, icon: Icon } = IMPORT[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

/** One entry's review outcome: colour, icon and text. */
export function EntryOutcome({ outcome }: { outcome: FhirImportEntryOutcome }) {
  const { label, variant, icon: Icon } = OUTCOME[outcome];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

/** Resource counts as text, e.g. "1 Patient, 2 AllergyIntolerance". */
export function countsText(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
}
