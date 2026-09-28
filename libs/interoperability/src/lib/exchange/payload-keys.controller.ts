import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePlatformAdmin } from "@healthcare/core";
import { PayloadKeyUsageService } from "./payload-keys.service";

@ApiTags("integrations")
@ApiBearerAuth()
@Controller({ path: "integrations/payload-keys", version: "1" })
export class PayloadKeysController {
  constructor(private readonly usage: PayloadKeyUsageService) {}

  @Get()
  @RequirePlatformAdmin()
  @ApiOperation({
    summary: "Integration payload keys: which key ids stored values still need, across the platform (platform administrators; counts only)",
  })
  list(@CurrentActor() actor: Actor) {
    return this.usage.usage(actor);
  }
}
