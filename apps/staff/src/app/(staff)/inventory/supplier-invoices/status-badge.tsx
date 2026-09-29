import { AlarmClockIcon, BanIcon, CircleCheckIcon, ClockIcon, WalletIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { SupplierInvoice } from "@/lib/api/types";
import { SUPPLIER_INVOICE_STATUS } from "@/lib/inventory-mapping";

/** Supplier invoice status (and overdue): colour, icon and text. */
export function SupplierInvoiceStatusBadge({ invoice }: { invoice: Pick<SupplierInvoice, "status" | "overdue"> }) {
  const label = SUPPLIER_INVOICE_STATUS[invoice.status];
  const badge =
    invoice.status === "paid" ? (
      <Badge variant="success">
        <WalletIcon aria-hidden /> {label}
      </Badge>
    ) : invoice.status === "approved" ? (
      <Badge variant="info">
        <CircleCheckIcon aria-hidden /> {label}
      </Badge>
    ) : invoice.status === "void" ? (
      <Badge variant="outline">
        <BanIcon aria-hidden /> {label}
      </Badge>
    ) : (
      <Badge variant="warning">
        <ClockIcon aria-hidden /> {label}
      </Badge>
    );
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badge}
      {invoice.overdue ? (
        <Badge variant="danger">
          <AlarmClockIcon aria-hidden /> Overdue
        </Badge>
      ) : null}
    </span>
  );
}
