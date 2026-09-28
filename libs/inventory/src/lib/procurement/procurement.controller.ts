import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  CreatePurchaseOrderDto,
  EndPurchaseOrderDto,
  PurchaseOrderQueryDto,
  PurchaseOrderVersionDto,
  ReceivePurchaseOrderDto,
  ReorderSuggestionQueryDto,
  UpdatePurchaseOrderDto,
} from "./procurement.dto";
import { PurchaseOrderService } from "./purchase-order.service";

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
