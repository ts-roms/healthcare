import { Module } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { InventoryCatalogService } from "./catalog/inventory-catalog.service";
import { InventoryCatalogController, InventoryStockController } from "./inventory.controllers";
import { ProcurementController } from "./procurement/procurement.controller";
import { PurchaseOrderService } from "./procurement/purchase-order.service";
import { InventoryQueries } from "./stock/inventory-queries";
import { InventoryStockService } from "./stock/inventory-stock.service";

/**
 * Inventory (Phase 9): items, suppliers, storage locations, lots and expiry, the stock ledger and balances, purchase
 * orders, and the stock contract other workflows use (through ports wired in the API) inside their transactions.
 */
@Module({
  imports: [OrganizationModule],
  controllers: [InventoryCatalogController, InventoryStockController, ProcurementController],
  providers: [InventoryCatalogService, InventoryStockService, InventoryQueries, PurchaseOrderService],
  exports: [InventoryStockService, InventoryQueries],
})
export class InventoryModule {}
