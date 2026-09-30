import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { OrganizationModule } from "@healthcare/organization";
import { AccessGuard } from "./access.guard";
import { AccessService } from "./access.service";
import { ActorResolver } from "./actor-resolver";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PermissionCatalogCheck } from "./permission-catalog.check";
import { SessionService } from "./session.service";
import { StaffPasswordResetService } from "./staff-password-reset.service";
import { StaffSecurityMailers } from "./staff-security-mailer";
import { TokenService } from "./tokens";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * Authentication, sessions, RBAC and the global AccessGuard.
 * Importing this module secures every route in the application by default.
 */
@Module({
  imports: [JwtModule.register({}), OrganizationModule],
  controllers: [AuthController, UsersController],
  providers: [
    AccessService,
    ActorResolver,
    AuthService,
    PermissionCatalogCheck,
    SessionService,
    StaffPasswordResetService,
    StaffSecurityMailers,
    TokenService,
    UsersService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AccessService, ActorResolver, AuthService, StaffSecurityMailers, UsersService],
})
export class AuthModule {}
