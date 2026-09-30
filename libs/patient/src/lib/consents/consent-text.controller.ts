import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ConsentTextService, PublishConsentTextDto } from "./consent-text.service";

/** The organization's consent wording for consents patients give online (`consent.wording.manage`). */
@ApiTags("consent wording")
@ApiBearerAuth()
@Controller({ path: "consent-texts", version: "1" })
export class ConsentTextController {
  constructor(private readonly texts: ConsentTextService) {}

  @Get()
  @RequirePermissions("consent.wording.manage")
  @ApiOperation({ summary: "For each consent patients may give online: the current wording and every version" })
  list(@CurrentActor() actor: Actor) {
    return this.texts.list(actor);
  }

  @Post()
  @RequirePermissions("consent.wording.manage")
  @ApiOperation({ summary: "Publish a new version of a wording, or stop offering the consent online (versions are never edited)" })
  publish(@CurrentActor() actor: Actor, @Body() body: PublishConsentTextDto) {
    return this.texts.publish(actor, body);
  }
}
