import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { DrawPractitionerSignatureDto, UpdatePractitionerSignatureSettingDto } from "./practitioner-signature.dto";
import { PractitionerSignatureService } from "./practitioner-signature.service";

@ApiTags("practitioner signatures")
@ApiBearerAuth()
@Controller({ version: "1" })
export class PractitionerSignatureController {
  constructor(private readonly signatures: PractitionerSignatureService) {}

  @Get("clinic/practitioner-signature/settings")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Whether certificates and referral letters print the issuing practitioner's signature" })
  settings(@CurrentActor() actor: Actor) {
    return this.signatures.settings(actor.organizationId);
  }

  @Put("clinic/practitioner-signature/settings")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Turn printing practitioners' signatures on certificates and referral letters on or off (versioned)" })
  updateSettings(@CurrentActor() actor: Actor, @Body() body: UpdatePractitionerSignatureSettingDto) {
    return this.signatures.updateSettings(actor, body);
  }

  @Get("me/practitioner-signature")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "The signed-in practitioner's own signature (only they see its strokes)" })
  mine(@CurrentActor() actor: Actor) {
    return this.signatures.mine(actor);
  }

  @Put("me/practitioner-signature")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Draw the signed-in practitioner's signature, replacing the one in force (earlier documents keep the one they printed)" })
  draw(@CurrentActor() actor: Actor, @Body() body: DrawPractitionerSignatureDto) {
    return this.signatures.draw(actor, body);
  }

  @Post("me/practitioner-signature/withdraw")
  @HttpCode(200)
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Withdraw the signed-in practitioner's signature: documents issued from now on print none" })
  withdraw(@CurrentActor() actor: Actor) {
    return this.signatures.withdraw(actor);
  }
}
