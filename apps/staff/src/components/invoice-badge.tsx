import { BanIcon, CheckCircle2Icon, CircleDashedIcon, CircleDollarSignIcon, FileEditIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { InvoiceSummary } from "@/lib/api/types";
import { INVOICE_STATE_LABEL, type InvoiceState, invoiceState } from "@/lib/billing-mapping";

const LOOK: Record<InvoiceState, { variant: "neutral" | "warning" | "info" | "success" | "danger"; icon: typeof BanIcon }> = {
  draft: { variant: "neutral", icon: FileEditIcon },
  unpaid: { variant: "warning", icon: CircleDollarSignIcon },
  partly_paid: { variant: "info", icon: CircleDashedIcon },
  paid: { variant: "success", icon: CheckCircle2Icon },
  void: { variant: "danger", icon: BanIcon },
};

/** Invoice state with icon and text (never colour alone). */
export function InvoiceBadge({ invoice }: { invoice: Pick<InvoiceSummary, "status" | "patientTotal" | "paidTotal" | "balance"> }) {
  const state = invoiceState(invoice);
  const { variant, icon: Icon } = LOOK[state];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden /> {INVOICE_STATE_LABEL[state]}
    </Badge>
  );
}
