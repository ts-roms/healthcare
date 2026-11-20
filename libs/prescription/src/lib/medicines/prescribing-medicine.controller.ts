import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { MedicineSettingDto, MedicineSettingsQueryDto, UpdateMedicineSettingDto } from "../prescription.dto";
import { PrescribingMedicineService } from "./prescribing-medicine.service";

/** The organization's own medicine settings for the assistant's prescribing rules (migration 0156). */
@ApiTags("prescriptions")
@ApiBearerAuth()
@Controller({ path: "prescribing", version: "1" })
export class PrescribingMedicineController {
  constructor(private readonly medicines: PrescribingMedicineService) {}

  @Get("medicines")
  @RequirePermissions("prescription.read")
  @ApiOperation({ summary: "The organization's medicine settings: classes, maximum daily doses and checks before prescribing" })
  list(@CurrentActor() actor: Actor, @Query() query: MedicineSettingsQueryDto) {
    return this.medicines.list(actor.organizationId, query.includeInactive === "true");
  }

  @Post("medicines")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Add a medicine setting (409 duplicate_medicine_setting when the medicine has one)" })
  create(@CurrentActor() actor: Actor, @Body() body: MedicineSettingDto) {
    return this.medicines.create(actor, body);
  }

  @Put("medicines/:id")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Change a medicine setting, or turn it off or on (version as last read)" })
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateMedicineSettingDto) {
    return this.medicines.update(actor, id, body);
  }
}
