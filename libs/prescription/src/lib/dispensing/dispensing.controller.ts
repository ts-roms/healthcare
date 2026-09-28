import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { DispenseDto, RecentDispensesDto, ReverseDispenseDto } from "./dispensing.dto";
import { PrescriptionDispenseService } from "./prescription-dispense.service";

@ApiTags("dispensing")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "dispensing", version: "1" })
export class DispensingController {
  constructor(private readonly dispensing: PrescriptionDispenseService) {}

  @Get("stock")
  @RequirePermissions("prescription.dispense", "inventory.read")
  @ApiOperation({ summary: "Medicines and supplies with usable stock at the selected facility, per location" })
  stock(@CurrentActor() actor: Actor) {
    return this.dispensing.available(actor);
  }

  @Get("prescriptions")
  @RequirePermissions("prescription.dispense")
  @ApiOperation({ summary: "Find a prescription by its number (RX########)" })
  find(@CurrentActor() actor: Actor, @Query("number") number = "") {
    return this.dispensing.findByNumber(actor, number);
  }

  @Get("prescriptions/:prescriptionId")
  @RequirePermissions("prescription.dispense")
  @ApiOperation({ summary: "A prescription for dispensing: patient identification, items, dispensed so far and remaining" })
  get(@CurrentActor() actor: Actor, @Param("prescriptionId", ParseUUIDPipe) id: string) {
    return this.dispensing.forPrescription(actor, id);
  }

  @Post("prescriptions/:prescriptionId/dispenses")
  @RequirePermissions("prescription.dispense", "inventory.move")
  @ApiOperation({ summary: "Dispense items of an active prescription from stock (first-expiry-first-out; never more than prescribed in the same unit)" })
  dispense(@CurrentActor() actor: Actor, @Param("prescriptionId", ParseUUIDPipe) id: string, @Body() body: DispenseDto) {
    return this.dispensing.dispense(actor, id, body);
  }

  @Post("dispenses/:dispenseId/reverse")
  @HttpCode(200)
  @RequirePermissions("prescription.dispense", "inventory.move")
  @ApiOperation({ summary: "Reverse a mistaken dispense (with a reason): the stock returns to the same lots" })
  reverse(@CurrentActor() actor: Actor, @Param("dispenseId", ParseUUIDPipe) id: string, @Body() body: ReverseDispenseDto) {
    return this.dispensing.reverse(actor, id, body.reason);
  }

  @Get("dispenses")
  @RequirePermissions("prescription.dispense")
  @ApiOperation({ summary: "Dispenses at the selected facility on a day (default today)" })
  recent(@CurrentActor() actor: Actor, @Query() query: RecentDispensesDto) {
    return this.dispensing.recent(actor, query.date);
  }
}
