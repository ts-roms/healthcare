import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePlatformAdmin } from "@healthcare/core";
import { CreateTenantDto, TenantStatusDto } from "./platform-tenants.dto";
import { PlatformTenantsService } from "./platform-tenants.service";

/**
 * Platform console: every tenant on the platform (docs/architecture/platform-console.md). Platform administrators only,
 * with two-step verification; operational figures, never a patient's data; every view and change audited.
 */
@ApiTags("platform")
@ApiBearerAuth()
@Controller({ path: "platform/tenants", version: "1" })
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Every organization with its status and operational figures (patient counts under five shown as <5)" })
  list(@CurrentActor() actor: Actor) {
    return this.tenants.list(actor);
  }

  @Get(":organizationId")
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "One organization: figures, facilities, administrators and status history" })
  get(@CurrentActor() actor: Actor, @Param("organizationId", ParseUUIDPipe) organizationId: string) {
    return this.tenants.get(actor, organizationId);
  }

  @Post()
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Create a tenant with its first facility and administrator, in one transaction" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateTenantDto) {
    return this.tenants.create(actor, body);
  }

  @Post(":organizationId/status")
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Suspend (ends every staff and MyHealth session) or reactivate an organization, with a reason" })
  changeStatus(@CurrentActor() actor: Actor, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() body: TenantStatusDto) {
    return this.tenants.changeStatus(actor, organizationId, body);
  }
}
