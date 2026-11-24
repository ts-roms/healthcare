import { CircleCheckIcon, CirclePauseIcon, ArchiveIcon } from "lucide-react";
import { Badge } from "@healthcare/ui/primitives";

/** An organization's status: colour, icon and text (never colour alone). */
export function TenantStatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge variant="success">
        <CircleCheckIcon aria-hidden /> Active
      </Badge>
    );
  }
  if (status === "suspended") {
    return (
      <Badge variant="danger">
        <CirclePauseIcon aria-hidden /> Suspended
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <ArchiveIcon aria-hidden /> Archived
    </Badge>
  );
}

/** "<5" stays as it is; other counts are formatted. */
export function countLabel(n: number | string): string {
  return typeof n === "number" ? n.toLocaleString("en-PH") : n;
}
