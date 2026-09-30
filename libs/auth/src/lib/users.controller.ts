import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { CreateRoleDto, CreateUserDto, GrantRoleDto, ResetMfaDto, ResetPasswordDto, UpdateMembershipDto } from "./users.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller({ version: "1" })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("users")
  @RequirePermissions("user.read")
  list(@CurrentActor() actor: Actor) {
    return this.users.list(actor.organizationId);
  }

  @Post("users")
  @RequirePermissions("user.manage")
  @ApiOperation({ summary: "Add a staff member to the organization" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateUserDto) {
    return this.users.create(actor, body);
  }

  @Get("users/:userId")
  @RequirePermissions("user.read")
  get(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.users.get(actor.organizationId, userId);
  }

  @Patch("users/:userId/membership")
  @RequirePermissions("user.manage")
  @ApiOperation({ summary: "Suspend or reactivate a member; suspension ends their sessions" })
  updateMembership(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: UpdateMembershipDto) {
    return this.users.updateMembership(actor, userId, body);
  }

  @Post("users/:userId/password-reset")
  @HttpCode(200)
  @RequirePermissions("user.manage")
  @ApiOperation({
    summary:
      "Give a member a temporary password to replace at the next sign-in (ends their sessions; accounts shared with other organizations need a platform administrator)",
  })
  resetPassword(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: ResetPasswordDto) {
    return this.users.resetPassword(actor, userId, body);
  }

  @Post("users/:userId/mfa-reset")
  @HttpCode(200)
  @RequirePermissions("user.manage")
  @ApiOperation({ summary: "Turn off a member's two-step verification (e.g. a lost phone); ends their sessions" })
  resetMfa(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: ResetMfaDto) {
    return this.users.resetMfa(actor, userId, body);
  }

  @Post("users/:userId/role-assignments")
  @RequirePermissions("user.manage")
  grantRole(@CurrentActor() actor: Actor, @Param("userId", ParseUUIDPipe) userId: string, @Body() body: GrantRoleDto) {
    return this.users.grantRole(actor, userId, body);
  }

  @Delete("users/:userId/role-assignments/:assignmentId")
  @RequirePermissions("user.manage")
  revokeRole(
    @CurrentActor() actor: Actor,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("assignmentId", ParseUUIDPipe) assignmentId: string,
    @Query("reason") reason?: string,
  ) {
    return this.users.revokeRole(actor, userId, assignmentId, reason?.slice(0, 500));
  }

  @Get("roles")
  @RequirePermissions("user.read")
  listRoles(@CurrentActor() actor: Actor) {
    return this.users.listRoles(actor.organizationId);
  }

  @Post("roles")
  @RequirePermissions("role.manage")
  createRole(@CurrentActor() actor: Actor, @Body() body: CreateRoleDto) {
    return this.users.createRole(actor, body);
  }

  @Get("permissions")
  @RequirePermissions("user.read")
  listPermissions() {
    return this.users.listPermissions();
  }
}
