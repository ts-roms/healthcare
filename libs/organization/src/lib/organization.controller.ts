import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions, RequirePlatformAdmin } from "@healthcare/core";
import { CreateDepartmentDto, CreateFacilityDto, CreateOrganizationDto, UpdateFacilityDto } from "./organization.dto";
import { OrganizationService } from "./organization.service";

@ApiTags("organization")
@Controller({ version: "1" })
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Post("organizations")
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Create an organization (platform administrators only)" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateOrganizationDto) {
    return this.organizations.createOrganization(actor, body);
  }

  @Get("organization")
  @RequirePermissions("organization.read")
  @ApiOperation({ summary: "The organization of the current session" })
  current(@CurrentActor() actor: Actor) {
    return this.organizations.getOrganization(actor.organizationId);
  }

  @Get("facilities")
  @RequirePermissions("organization.read")
  listFacilities(@CurrentActor() actor: Actor) {
    return this.organizations.listFacilities(actor.organizationId);
  }

  @Post("facilities")
  @RequirePermissions("organization.manage")
  createFacility(@CurrentActor() actor: Actor, @Body() body: CreateFacilityDto) {
    return this.organizations.createFacility(actor, body);
  }

  @Get("facilities/:facilityId")
  @RequirePermissions("organization.read")
  getFacility(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string) {
    return this.organizations.getFacility(actor.organizationId, facilityId);
  }

  @Patch("facilities/:facilityId")
  @RequirePermissions("organization.manage")
  updateFacility(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: UpdateFacilityDto) {
    return this.organizations.updateFacility(actor, facilityId, body);
  }

  @Get("facilities/:facilityId/departments")
  @RequirePermissions("organization.read")
  listDepartments(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string) {
    return this.organizations.listDepartments(actor.organizationId, facilityId);
  }

  @Post("facilities/:facilityId/departments")
  @RequirePermissions("organization.manage")
  createDepartment(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: CreateDepartmentDto) {
    return this.organizations.createDepartment(actor, facilityId, body);
  }
}
