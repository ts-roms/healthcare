import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { ControlledRegisterSettingDto, CreateProcurementMethodDto, CreateWithholdingCodeDto } from "../procurement/procurement.dto";
import { InventoryComplianceService } from "./inventory-compliance.service";

/**
 * The organization's own withholding codes and procurement methods, and each facility's register header. The register
 * itself is composed in the API (it adds staff names): `GET /inventory/controlled-register`.
 */
@ApiTags("inventory compliance")
@ApiBearerAuth()
@Controller({ path: "inventory", version: "1" })
export class InventoryComplianceController {
  constructor(private readonly compliance: InventoryComplianceService) {}

  @Get("withholding-codes")
  @RequirePermissions("inventory.read")
  withholdingCodes(@CurrentActor() actor: Actor) {
    return this.compliance.withholdingCodes(actor.organizationId);
  }

  @Post("withholding-codes")
  @RequirePermissions("inventory.procurement.approve")
  @ApiOperation({ summary: "Add one of the organization's withholding codes (the rate is for reference; amounts are entered at payment)" })
  createWithholdingCode(@CurrentActor() actor: Actor, @Body() body: CreateWithholdingCodeDto) {
    return this.compliance.createWithholdingCode(actor, body);
  }

  @Post("withholding-codes/:id/deactivate")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.approve")
  deactivateWithholdingCode(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.compliance.deactivateWithholdingCode(actor, id);
  }

  @Get("procurement-methods")
  @RequirePermissions("inventory.read")
  procurementMethods(@CurrentActor() actor: Actor) {
    return this.compliance.procurementMethods(actor.organizationId);
  }

  @Post("procurement-methods")
  @RequirePermissions("inventory.procurement.approve")
  @ApiOperation({ summary: "Add one of the organization's procurement methods (once any exist, orders name one when submitted)" })
  createProcurementMethod(@CurrentActor() actor: Actor, @Body() body: CreateProcurementMethodDto) {
    return this.compliance.createProcurementMethod(actor, body);
  }

  @Post("procurement-methods/:id/deactivate")
  @HttpCode(200)
  @RequirePermissions("inventory.procurement.approve")
  deactivateProcurementMethod(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.compliance.deactivateProcurementMethod(actor, id);
  }

  @Get("controlled-register/setting")
  @RequireFacility()
  @RequirePermissions("inventory.controlled-register.read")
  registerSetting(@CurrentActor() actor: Actor) {
    return this.compliance.registerSetting(actor);
  }

  @Put("controlled-register/setting")
  @RequireFacility()
  @RequirePermissions("inventory.controlled-register.read", "inventory.catalog.manage")
  @ApiOperation({ summary: "The facility's register header: licence reference and responsible person as recorded (not verified)" })
  setRegisterSetting(@CurrentActor() actor: Actor, @Body() body: ControlledRegisterSettingDto) {
    return this.compliance.setRegisterSetting(actor, body);
  }
}
