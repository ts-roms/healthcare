import Link from "next/link";
import { BoxesIcon, HistoryIcon, SettingsIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";

export function InventoryNav({ canConfigure }: { canConfigure: boolean }) {
  return (
    <nav aria-label="Inventory" className="flex items-center gap-1">
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
