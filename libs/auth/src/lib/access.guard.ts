import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuditService } from "@healthcare/audit";
import {
  ACCESS_METADATA,
  asPlatform,
  BadRequestError,
  DomainError,
  ForbiddenError,
  type Permission,
  requestMetadataFrom,
  setRequestOrganization,
  setRequestPlatformScope,
  UnauthenticatedError,
} from "@healthcare/core";
import type { Request } from "express";
import { ActorResolver } from "./actor-resolver";

/**
 * Global guard: authenticates every request (unless @Public), resolves the
 * organization/facility/department context and effective permissions, and
 * enforces route access metadata. Denials are audited (not the two-step verification enrollment redirect, which
 * repeats on every page until the member sets it up; the policy change and enrollment are audited).
 *
 * The session is checked on every request so logout, password change and
 * membership suspension take effect immediately, not at token expiry.
 */
export class PasswordChangeRequiredError extends DomainError {
  readonly code = "password_change_required";
  readonly httpStatus = 403;
  constructor() {
    super("Choose a new password before continuing");
  }
}

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
    if (this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.public, targets)) {
      // Public routes that look up an account, a link or a provider's notification before the organization is known
      // say so with @PlatformScope (row-level security, migration 0111); the others stay without a context.
      const platformScope = this.reflector.getAllAndOverride<string | undefined>(ACCESS_METADATA.platformScope, targets);
      if (platformScope) setRequestPlatformScope(platformScope);
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header("authorization");
    const match = header ? /^Bearer (\S+)$/i.exec(header) : null;
    if (!match?.[1]) throw new UnauthenticatedError();
    // The session and memberships are looked up before the organization is known; from then on every query of the
    // request is held to the actor's organization by row-level security (migration 0111).
    const actor = await asPlatform("resolve the signed-in member", () =>
      this.actors.resolve(
        match[1]!,
        { facilityId: request.header("x-facility-id"), departmentId: request.header("x-department-id") },
        requestMetadataFrom(request),
      ),
    );
    request.actor = actor;
    setRequestOrganization(actor.organizationId);
    // Account set-up comes first: a temporary password from an administrator is replaced (0090), and two-step verification
    // the organization requires is set up; until then only the person's own account routes answer.
    if (!this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.mfaEnrollment, targets)) {
      if (actor.passwordChangeRequired) throw new PasswordChangeRequiredError();
      if (actor.mfaEnrollmentRequired) {
        throw new ForbiddenError("Your organization requires two-step verification. Set it up in My account to continue.", "mfa_enrollment_required");
      }
    }

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
    // A platform administrator route works across organizations on purpose (organizations, rate limits, audit
    // retention, payload keys).
    if (needsPlatformAdmin) setRequestPlatformScope("platform administrator route");
    return true;
  }
}
