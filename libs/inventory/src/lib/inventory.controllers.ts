import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { InventoryCatalogService } from "./catalog/inventory-catalog.service";
import {
  AdjustDto,
  CreateItemDto,
  CreateLocationDto,
  CreateSupplierDto,
  IssueDto,
  MovementsQueryDto,
  ReceiveDto,
  ReorderLevelDto,
  StockQueryDto,
  TransferDto,
  UpdateItemDto,
  WriteOffDto,
} from "./inventory.dto";
import { InventoryStockService } from "./stock/inventory-stock.service";

@ApiTags("inventory")
@ApiBearerAuth()
@Controller({ path: "inventory", version: "1" })
export class InventoryCatalogController {
  constructor(private readonly catalog: InventoryCatalogService) {}

  @Get("items")
  @RequirePermissions("inventory.read")
  items(@CurrentActor() actor: Actor) {
    return this.catalog.items(actor.organizationId);
  }

  @Post("items")
  @RequirePermissions("inventory.catalog.manage")
  @ApiOperation({ summary: "Add an item (medicine, supply, reagent…) with its stock unit and whether it is tracked by lot" })
  createItem(@CurrentActor() actor: Actor, @Body() body: CreateItemDto) {
    return this.catalog.createItem(actor, body);
  }

  @Patch("items/:itemId")
  @RequirePermissions("inventory.catalog.manage")
  updateItem(@CurrentActor() actor: Actor, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() body: UpdateItemDto) {
    return this.catalog.updateItem(actor, itemId, body);
  }

  @Get("suppliers")
  @RequirePermissions("inventory.read")
  suppliers(@CurrentActor() actor: Actor) {
    return this.catalog.suppliers(actor.organizationId);
  }

  @Post("suppliers")
  @RequirePermissions("inventory.catalog.manage")
  createSupplier(@CurrentActor() actor: Actor, @Body() body: CreateSupplierDto) {
    return this.catalog.createSupplier(actor, body);
  }

  @Get("locations")
  @RequirePermissions("inventory.read")
  @ApiOperation({ summary: "Storage locations of the organization (for transfers) or of the selected facility (?scope=facility)" })
  locations(@CurrentActor() actor: Actor, @Query("scope") scope?: string) {
    return this.catalog.locations(actor.organizationId, scope === "facility" ? actor.facilityId : undefined);
  }

  @Post("locations")
  @RequirePermissions("inventory.catalog.manage")
  createLocation(@CurrentActor() actor: Actor, @Body() body: CreateLocationDto) {
    return this.catalog.createLocation(actor, body);
  }

  @Put("locations/:locationId/items/:itemId/reorder-level")
  @RequireFacility()
  @RequirePermissions("inventory.catalog.manage")
  setReorderLevel(
    @CurrentActor() actor: Actor,
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() body: ReorderLevelDto,
  ) {
    return this.catalog.setReorderLevel(actor, locationId, itemId, body.reorderLevel);
  }
}

@ApiTags("inventory")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "inventory", version: "1" })
export class InventoryStockController {
  constructor(private readonly stock: InventoryStockService) {}

  @Get("stock")
  @RequirePermissions("inventory.read")
  @ApiOperation({ summary: "Stock at the selected facility: on hand, usable, lots and expiry, reorder level and status (?show=low|expiring)" })
  list(@CurrentActor() actor: Actor, @Query() query: StockQueryDto) {
    return this.stock.stock(actor, query);
  }

  @Get("movements")
  @RequirePermissions("inventory.read")
  movements(@CurrentActor() actor: Actor, @Query() query: MovementsQueryDto) {
    return this.stock.movements(actor, query);
  }

  @Post("receipts")
  @RequirePermissions("inventory.move")
  @ApiOperation({ summary: "Receive stock into a location (lot and expiry for lot-tracked items; supplier, cost, delivery reference)" })
  receive(@CurrentActor() actor: Actor, @Body() body: ReceiveDto) {
    return this.stock.receive(actor, body);
  }

  @Post("issues")
  @RequirePermissions("inventory.move")
  @ApiOperation({ summary: "Issue stock to a department or purpose (lots first-expiry-first-out unless one is named; never expired)" })
  issue(@CurrentActor() actor: Actor, @Body() body: IssueDto) {
    return this.stock.issue(actor, body);
  }

  @Post("transfers")
  @RequirePermissions("inventory.move")
  transfer(@CurrentActor() actor: Actor, @Body() body: TransferDto) {
    return this.stock.transfer(actor, body);
  }

  @Post("adjustments")
  @HttpCode(201)
  @RequirePermissions("inventory.adjust")
  @ApiOperation({ summary: "Record a physical count (the difference is posted, with the reason)" })
  adjust(@CurrentActor() actor: Actor, @Body() body: AdjustDto) {
    return this.stock.adjust(actor, body);
  }

  @Post("write-offs")
  @RequirePermissions("inventory.adjust")
  @ApiOperation({ summary: "Write off expired, damaged or lost stock (with the reason)" })
  writeOff(@CurrentActor() actor: Actor, @Body() body: WriteOffDto) {
    return this.stock.writeOff(actor, body);
  }
}
