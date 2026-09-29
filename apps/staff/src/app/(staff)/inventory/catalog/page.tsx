import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryItem, InventoryLocation, InventorySupplier } from "@/lib/api/types";
import { InventoryNav } from "../inventory-nav";
import { InventoryCatalog } from "./inventory-catalog";

export const metadata = { title: "Inventory catalog" };

export default async function InventoryCatalogPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "inventory.catalog.manage")) redirect("/inventory");
  const [items, suppliers, locations] = await Promise.all([
    api<InventoryItem[]>("/inventory/items"),
    api<InventorySupplier[]>("/inventory/suppliers"),
    api<InventoryLocation[]>("/inventory/locations"),
  ]);
  return (
    <>
      <PageHeader
        title="Inventory catalog"
        description="Items, suppliers, storage locations and reorder levels."
        actions={<InventoryNav canConfigure canValue={can(session, "inventory.valuation.read")} />}
      />
      <InventoryCatalog items={items} suppliers={suppliers} locations={locations} facility={facility ? { id: facility.id, name: facility.name } : null} />
    </>
  );
}
