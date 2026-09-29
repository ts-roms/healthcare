import Link from "next/link";
import { BoxesIcon, CoinsIcon, FileTextIcon, HistoryIcon, SettingsIcon, TruckIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

export function InventoryNav({ canConfigure, canValue = false }: { canConfigure: boolean; canValue?: boolean }) {
  return (
    <nav aria-label="Inventory" className="flex flex-wrap items-center gap-1">
      <Button asChild variant="outline" size="sm">
        <Link href="/inventory">
          <BoxesIcon /> Stock
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/inventory/movements">
          <HistoryIcon /> Movements
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/inventory/purchase-orders">
          <TruckIcon /> Purchase orders
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/inventory/supplier-invoices">
          <FileTextIcon /> Supplier invoices
        </Link>
      </Button>
      {canValue ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/inventory/valuation">
            <CoinsIcon /> Valuation
          </Link>
        </Button>
      ) : null}
      {canConfigure ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/inventory/catalog">
            <SettingsIcon /> Catalog
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
