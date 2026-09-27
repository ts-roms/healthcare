import { CircleAlertIcon, CircleCheckIcon, CircleXIcon, ClockIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";
import type { StockRow } from "@/lib/api/types";

/** Stock and expiry status: colour, icon and text (never colour alone). */
export function StockStatus({ status }: { status: StockRow["status"] }) {
  if (status === "out")
    return (
      <Badge variant="danger">
        <CircleXIcon aria-hidden /> Out of stock
      </Badge>
    );
  if (status === "low")
    return (
      <Badge variant="warning">
        <CircleAlertIcon aria-hidden /> Low
      </Badge>
    );
  return (
    <Badge variant="success">
      <CircleCheckIcon aria-hidden /> In stock
    </Badge>
  );
}

export function ExpiryStatus({ expiry }: { expiry: StockRow["lots"][number]["expiry"] }) {
  if (expiry === "expired")
    return (
      <Badge variant="danger">
        <CircleXIcon aria-hidden /> Expired
      </Badge>
    );
  if (expiry === "expiring")
    return (
      <Badge variant="warning">
        <ClockIcon aria-hidden /> Expiring
      </Badge>
    );
  return null;
}
