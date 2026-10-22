import { StaffSettingsPage, SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { InventoryItem, InventoryLocation, InventorySupplier } from "@/lib/api/types";
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
    <StaffSettingsPage group="Operations" title="Inventory catalog" description="Items, suppliers, storage locations and reorder levels.">
      <SettingsStack>
        <InventoryCatalog items={items} suppliers={suppliers} locations={locations} facility={facility ? { id: facility.id, name: facility.name } : null} />
      </SettingsStack>
    </StaffSettingsPage>
  );
}
