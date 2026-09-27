import Link from "next/link";
import { BarChart3Icon, FileTextIcon, SettingsIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

/** Links between the billing screens, shown in each page header. */
export function BillingNav({ canReport, canConfigure }: { canReport: boolean; canConfigure: boolean }) {
  return (
    <nav aria-label="Billing" className="flex items-center gap-1">
      <Button asChild variant="outline" size="sm">
        <Link href="/billing/invoices">
          <FileTextIcon /> Invoices
        </Link>
      </Button>
      {canReport ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/billing/reports">
            <BarChart3Icon /> Daily report
          </Link>
        </Button>
      ) : null}
      {canConfigure ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/billing/settings">
            <SettingsIcon /> Prices and discounts
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
