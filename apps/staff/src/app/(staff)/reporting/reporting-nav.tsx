import Link from "next/link";
import { ClipboardListIcon, SettingsIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

/** Links between the disease reporting screens. */
export function ReportingNav({ canConfigure }: { canConfigure: boolean }) {
  return (
    <nav aria-label="Disease reporting" className="flex items-center gap-1">
      <Button asChild variant="outline" size="sm">
        <Link href="/reporting">
          <ClipboardListIcon /> Case reports
        </Link>
      </Button>
      {canConfigure ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/reporting/settings">
            <SettingsIcon /> Reportable conditions
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
