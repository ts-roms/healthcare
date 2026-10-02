import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePlatformAdmin } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

const refusalsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(100).default(30) });
class RefusalsQueryDto extends createZodDto(refusalsQuerySchema) {}

@ApiTags("administration")
@ApiBearerAuth()
@Controller({ path: "rate-limits", version: "1" })
export class RateLimitsController {
  constructor(private readonly storage: RedisThrottlerStorage) {}

  @Get("refusals")
  @RequirePlatformAdmin()
  @ApiOperation({
    summary: "Rate-limit refusals per route and Asia/Manila day across the platform (platform administrators; route templates and counts only)",
  })
  async refusals(@Query() query: RefusalsQueryDto) {
    return { days: query.days, timeZone: "Asia/Manila", rows: await this.storage.refusals(query.days) };
  }
}
