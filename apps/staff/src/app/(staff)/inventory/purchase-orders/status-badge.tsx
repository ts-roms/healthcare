import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, ClockIcon, PackageCheckIcon, TruckIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { PurchaseOrderStatus } from "@/lib/api/types";
import { PURCHASE_ORDER_STATUS } from "@/lib/inventory-mapping";

/** Purchase order status: colour, icon and text. */
export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const label = PURCHASE_ORDER_STATUS[status];
  switch (status) {
    case "draft":
      return (
        <Badge variant="outline">
          <CircleDashedIcon aria-hidden /> {label}
        </Badge>
      );
    case "submitted":
      return (
        <Badge variant="warning">
          <ClockIcon aria-hidden /> {label}
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="info">
          <CircleCheckIcon aria-hidden /> {label}
        </Badge>
      );
    case "partially_received":
      return (
        <Badge variant="info">
          <TruckIcon aria-hidden /> {label}
        </Badge>
      );
    case "received":
      return (
        <Badge variant="success">
          <PackageCheckIcon aria-hidden /> {label}
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral">
          <CircleXIcon aria-hidden /> {label}
        </Badge>
      );
  }
}
