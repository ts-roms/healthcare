import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ListExchangesDto, ResolveExchangeDto } from "./exchange-review.dto";
import { ExchangeReviewService } from "./exchange-review.service";

@ApiTags("integrations")
@ApiBearerAuth()
@RequirePermissions("integration.exchange.manage")
@Controller({ path: "integrations/exchanges", version: "1" })
export class ExchangeReviewController {
  constructor(private readonly review: ExchangeReviewService) {}

  @Get()
  @ApiOperation({ summary: "Outbound exchanges: those needing attention (unsuccessful and unresolved, or stalled), or all" })
  list(@CurrentActor() actor: Actor, @Query() query: ListExchangesDto) {
    return this.review.list(actor, query);
  }

  @Post(":exchangeId/requeue")
  @HttpCode(200)
  @ApiOperation({ summary: "Put a queued exchange back on the integration worker's queue" })
  requeue(@CurrentActor() actor: Actor, @Param("exchangeId", ParseUUIDPipe) id: string) {
    return this.review.requeue(actor, id);
  }

  @Post(":exchangeId/resolve")
  @HttpCode(200)
  @ApiOperation({ summary: "Record that an unsuccessful exchange was reviewed (with a note); its outcome does not change" })
  resolve(@CurrentActor() actor: Actor, @Param("exchangeId", ParseUUIDPipe) id: string, @Body() body: ResolveExchangeDto) {
    return this.review.resolve(actor, id, body.note);
  }
}
