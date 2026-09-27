import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuditService } from "@healthcare/audit";
import { ACCESS_METADATA, BadRequestError, ForbiddenError, type Permission, requestMetadataFrom, UnauthenticatedError } from "@healthcare/core";
import type { Request } from "express";
import { ActorResolver } from "./actor-resolver";

/**
 * Global guard: authenticates every request (unless @Public), resolves the
 * organization/facility/department context and effective permissions, and
 * enforces route access metadata. Denials are audited.
 *
 * The session is checked on every request so logout, password change and
 * membership suspension take effect immediately, not at token expiry.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly actors: ActorResolver,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.public, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header("authorization");
    const match = header ? /^Bearer (\S+)$/i.exec(header) : null;
    if (!match?.[1]) throw new UnauthenticatedError();
    const actor = await this.actors.resolve(
      match[1],
      { facilityId: request.header("x-facility-id"), departmentId: request.header("x-department-id") },
      requestMetadataFrom(request),
    );
    request.actor = actor;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(ACCESS_METADATA.permissions, targets) ?? [];
    const needsPlatformAdmin = this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.platformAdmin, targets) ?? false;
    const needsFacility = this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.facility, targets) ?? false;

    if (needsFacility && !actor.facilityId) {
      throw new BadRequestError("X-Facility-Id header is required for this operation", "facility_required");
    }
    const missing = required.filter((permission) => !actor.permissions.has(permission));
    if (missing.length > 0 || (needsPlatformAdmin && !actor.isPlatformAdmin)) {
      await this.audit.recordStandalone(actor, {
        action: "access.deny",
        resourceType: "route",
        resourceId: `${request.method} ${request.route?.path ?? request.path}`,
        outcome: "denied",
        reason: missing.length > 0 ? "missing_permission" : "platform_admin_required",
        metadata: { missing },
      });
      throw new ForbiddenError();
    }
    return true;
  }
}
