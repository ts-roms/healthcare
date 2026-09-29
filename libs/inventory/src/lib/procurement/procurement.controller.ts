import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { InventoryValuationService } from "../stock/inventory-valuation.service";
import {
  ApproveSupplierInvoiceDto,
  CreatePurchaseOrderDto,
  PaySupplierInvoiceDto,
  RecordSupplierInvoiceDto,
  SupplierInvoiceQueryDto,
  UsageQueryDto,
  ValuationQueryDto,
  VoidSupplierInvoiceDto,
  EndPurchaseOrderDto,
  PurchaseOrderQueryDto,
  PurchaseOrderVersionDto,
  ReceivePurchaseOrderDto,
  ReorderSuggestionQueryDto,
  UpdatePurchaseOrderDto,
} from "./procurement.dto";
import { PurchaseOrderService } from "./purchase-order.service";
import { SupplierInvoiceService } from "./supplier-invoice.service";

@ApiTags("inventory")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "inventory", version: "1" })
export class ProcurementController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @Get("reorder-suggestions")
  @RequirePermissions("inventory.read")
  @ApiOperation({ summary: "Items at or below their reorder level at the selected facility, counting stock already on open purchase orders" })
  suggestions(@CurrentActor() actor: Actor, @Query() query: ReorderSuggestionQueryDto) {
    return this.orders.suggestions(actor, query.locationId);
  }

  @Get("purchase-orders")
  @RequirePermissions("inventory.read")
  list(@CurrentActor() actor: Actor, @Query() query: PurchaseOrderQueryDto) {
    return this.orders.list(actor, query);
  }

  @Get("purchase-orders/:purchaseOrderId")
  @RequirePermissions("inventory.read")
  get(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string) {
    return this.orders.get(actor, id);
  }

  @Post("purchase-orders")
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Draft a purchase order (supplier, delivery location of the facility, items and quantities in stock units)" })
  create(@CurrentActor() actor: Actor, @Body() body: CreatePurchaseOrderDto) {
    return this.orders.create(actor, body);
  }

  @Put("purchase-orders/:purchaseOrderId")
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Replace a draft's supplier, location, notes and lines" })
  update(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: UpdatePurchaseOrderDto) {
    return this.orders.update(actor, id, body);
  }

  @Post("purchase-orders/:purchaseOrderId/submit")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage")
  submit(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: PurchaseOrderVersionDto) {
    return this.orders.submit(actor, id, body.version);
  }

  @Post("purchase-orders/:purchaseOrderId/approve")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.approve")
  @ApiOperation({ summary: "Approve a submitted order (403 for the person who submitted it)" })
  approve(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: PurchaseOrderVersionDto) {
    return this.orders.approve(actor, id, body.version);
  }

  @Post("purchase-orders/:purchaseOrderId/receipts")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage", "inventory.move")
  @ApiOperation({ summary: "Receive a delivery against an approved order (lots and expiry; never more than outstanding; idempotent)" })
  receive(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: ReceivePurchaseOrderDto) {
    return this.orders.receive(actor, id, body);
  }

  @Post("purchase-orders/:purchaseOrderId/cancel")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Cancel an order before anything arrives (with a reason)" })
  cancel(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: EndPurchaseOrderDto) {
    return this.orders.cancel(actor, id, body);
  }

  @Post("purchase-orders/:purchaseOrderId/close")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Close an order short: no more deliveries expected (with a reason)" })
  close(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: EndPurchaseOrderDto) {
    return this.orders.close(actor, id, body);
  }
}

@ApiTags("inventory")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "inventory", version: "1" })
export class SupplierInvoiceController {
  constructor(private readonly invoices: SupplierInvoiceService) {}

  @Get("purchase-orders/:purchaseOrderId/invoicing")
  @RequirePermissions("inventory.read")
  @ApiOperation({ summary: "An order's lines with what was ordered, received and already invoiced (what the next invoice may cover)" })
  invoicing(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string) {
    return this.invoices.invoicing(actor, id);
  }

  @Post("purchase-orders/:purchaseOrderId/invoices")
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Record a supplier invoice against an order: never more than received and not yet invoiced; price differences are shown" })
  record(@CurrentActor() actor: Actor, @Param("purchaseOrderId", ParseUUIDPipe) id: string, @Body() body: RecordSupplierInvoiceDto) {
    return this.invoices.record(actor, id, body);
  }

  @Get("supplier-invoices")
  @RequirePermissions("inventory.read")
  list(@CurrentActor() actor: Actor, @Query() query: SupplierInvoiceQueryDto) {
    return this.invoices.list(actor, query);
  }

  @Get("supplier-invoices/:invoiceId")
  @RequirePermissions("inventory.read")
  get(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string) {
    return this.invoices.get(actor, id);
  }

  @Post("supplier-invoices/:invoiceId/approve")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.approve")
  @ApiOperation({ summary: "Approve for payment (not by the recorder; a price different from the order needs a note)" })
  approve(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: ApproveSupplierInvoiceDto) {
    return this.invoices.approve(actor, id, body);
  }

  @Post("supplier-invoices/:invoiceId/payment")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Mark an approved invoice paid (date and payment reference)" })
  pay(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: PaySupplierInvoiceDto) {
    return this.invoices.pay(actor, id, body);
  }

  @Post("supplier-invoices/:invoiceId/void")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.manage")
  @ApiOperation({ summary: "Void an unpaid invoice (reason required); it can then be recorded again" })
  void(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: VoidSupplierInvoiceDto) {
    return this.invoices.void(actor, id, body);
  }
}

@ApiTags("inventory")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "inventory", version: "1" })
export class InventoryValuationController {
  constructor(private readonly valuations: InventoryValuationService) {}

  @Get("valuation")
  @RequirePermissions("inventory.valuation.read")
  @ApiOperation({ summary: "Stock on hand at the selected facility at cost (lot cost = weighted average of its priced receipts); unvalued stock listed" })
  valuation(@CurrentActor() actor: Actor, @Query() query: ValuationQueryDto) {
    return this.valuations.valuation(actor, query);
  }

  @Get("valuation/usage")
  @RequirePermissions("inventory.valuation.read")
  @ApiOperation({ summary: "What was received, used and written off in a period of local days (≤ 366), at the cost each movement recorded" })
  usage(@CurrentActor() actor: Actor, @Query() query: UsageQueryDto) {
    return this.valuations.usage(actor, query);
  }
}
