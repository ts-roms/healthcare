import { Module } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { InventoryCatalogService } from "./catalog/inventory-catalog.service";
import { InventoryCatalogController, InventoryStockController } from "./inventory.controllers";
import { InventoryQueries } from "./stock/inventory-queries";
import { InventoryStockService } from "./stock/inventory-stock.service";

/** Inventory (Phase 9): items, suppliers, storage locations, lots and expiry, the stock ledger and balances. */
@Module({
  imports: [OrganizationModule],
  controllers: [InventoryCatalogController, InventoryStockController],
  providers: [InventoryCatalogService, InventoryStockService, InventoryQueries],
  exports: [InventoryStockService, InventoryQueries],
})
export class InventoryModule {}
