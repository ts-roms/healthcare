import { Module } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { InventoryCatalogService } from "./catalog/inventory-catalog.service";
import { InventoryComplianceController } from "./compliance/inventory-compliance.controller";
import { InventoryComplianceService } from "./compliance/inventory-compliance.service";
import { InventoryCatalogController, InventoryStockController } from "./inventory.controllers";
import { InventoryValuationController, ProcurementController, SupplierInvoiceController } from "./procurement/procurement.controller";
import { PurchaseOrderService } from "./procurement/purchase-order.service";
import { SupplierInvoiceService } from "./procurement/supplier-invoice.service";
import { InventoryQueries } from "./stock/inventory-queries";
import { InventoryReportingQueries } from "./stock/inventory-reporting.queries";
import { InventoryStockService } from "./stock/inventory-stock.service";
import { InventoryValuationService } from "./stock/inventory-valuation.service";

/**
 * Inventory (Phase 9): items, suppliers, storage locations, lots and expiry, the stock ledger and balances, purchase
 * orders and supplier invoices, valuation at cost, and the stock contract other workflows use (through ports wired in the API) inside their transactions.
 */
@Module({
  imports: [OrganizationModule],
  controllers: [
    InventoryCatalogController,
    InventoryStockController,
    ProcurementController,
    SupplierInvoiceController,
    InventoryValuationController,
    InventoryComplianceController,
  ],
  providers: [
    InventoryCatalogService,
    InventoryStockService,
    InventoryQueries,
    PurchaseOrderService,
    SupplierInvoiceService,
    InventoryValuationService,
    InventoryComplianceService,
    InventoryReportingQueries,
  ],
  exports: [InventoryStockService, InventoryQueries, InventoryComplianceService, InventoryReportingQueries],
})
export class InventoryModule {}
