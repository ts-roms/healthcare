import Link from "next/link";
import { BookLockIcon, BoxesIcon, CoinsIcon, FileTextIcon, HistoryIcon, LandmarkIcon, SettingsIcon, TruckIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

export function InventoryNav({ canConfigure, canValue = false, canRegister = false }: { canConfigure: boolean; canValue?: boolean; canRegister?: boolean }) {
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
      {canRegister ? (
        <Button asChild variant="outline" size="sm">
          <Link href="/inventory/controlled-register">
            <BookLockIcon /> Controlled register
          </Link>
        </Button>
      ) : null}
      <Button asChild variant="outline" size="sm">
        <Link href="/inventory/compliance">
          <LandmarkIcon /> Tax and procurement
        </Link>
      </Button>
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
