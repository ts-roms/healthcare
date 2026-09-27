import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '@healthcare/audit';
import {
  ACCESS_METADATA,
  type Actor,
  BadRequestError,
  ForbiddenError,
  type Permission,
  requestMetadataFrom,
  UnauthenticatedError,
} from '@healthcare/core';
import { OrganizationService } from '@healthcare/organization';
import type { Request } from 'express';
import { AccessService } from './access.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.public, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const actor = await this.authenticate(request);
    request.actor = actor;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(ACCESS_METADATA.permissions, targets) ?? [];
    const needsPlatformAdmin = this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.platformAdmin, targets) ?? false;
    const needsFacility = this.reflector.getAllAndOverride<boolean>(ACCESS_METADATA.facility, targets) ?? false;

    if (needsFacility && !actor.facilityId) {
      throw new BadRequestError('X-Facility-Id header is required for this operation', 'facility_required');
    }
    const missing = required.filter((permission) => !actor.permissions.has(permission));
    if (missing.length > 0 || (needsPlatformAdmin && !actor.isPlatformAdmin)) {
      await this.audit.recordStandalone(actor, {
        action: 'access.deny',
        resourceType: 'route',
        resourceId: `${request.method} ${request.route?.path ?? request.path}`,
        outcome: 'denied',
        reason: missing.length > 0 ? 'missing_permission' : 'platform_admin_required',
        metadata: { missing },
      });
      throw new ForbiddenError();
    }
    return true;
  }

  private async authenticate(request: Request): Promise<Actor> {
    const header = request.header('authorization');
    const match = header ? /^Bearer (\S+)$/i.exec(header) : null;
    if (!match?.[1]) throw new UnauthenticatedError();
    const claims = await this.tokens.verifyAccessToken(match[1]);

    const session = await this.sessions.findActive(claims.sid);
    if (!session || session.userId !== claims.sub || session.organizationId !== claims.org) {
      throw new UnauthenticatedError('Session has ended', 'session_ended');
    }
    const user = await this.auth.getUser(claims.sub);
    if (user.status !== 'active' || !(await this.auth.hasActiveMembership(user.id, claims.org))) {
      throw new UnauthenticatedError('Account access has been revoked', 'access_revoked');
    }

    const facilityId = await this.resolveFacility(request, claims.org);
    const departmentId = await this.resolveDepartment(request, claims.org, facilityId);
    const permissions = await this.access.resolvePermissions(user.id, claims.org, { facilityId, departmentId });

    return {
      kind: 'user',
      userId: user.id,
      displayName: user.displayName,
      sessionId: session.id,
      organizationId: claims.org,
      facilityId,
      isPlatformAdmin: user.isPlatformAdmin,
      permissions,
      request: requestMetadataFrom(request),
    };
  }

  private async resolveFacility(request: Request, organizationId: string): Promise<string | undefined> {
    const facilityId = request.header('x-facility-id');
    if (!facilityId) return undefined;
    if (!UUID.test(facilityId)) throw new BadRequestError('X-Facility-Id must be a UUID', 'invalid_facility');
    const facility = await this.organizations.findFacility(organizationId, facilityId);
    if (!facility || facility.status !== 'active') throw new ForbiddenError('Facility is not accessible');
    return facility.id;
  }

  private async resolveDepartment(request: Request, organizationId: string, facilityId: string | undefined): Promise<string | undefined> {
    const departmentId = request.header('x-department-id');
    if (!departmentId) return undefined;
    if (!facilityId) throw new BadRequestError('X-Department-Id requires X-Facility-Id', 'facility_required');
    if (!UUID.test(departmentId)) throw new BadRequestError('X-Department-Id must be a UUID', 'invalid_department');
    const department = await this.organizations.findDepartment(organizationId, facilityId, departmentId);
    if (!department || department.status !== 'active') throw new ForbiddenError('Department is not accessible');
    return department.id;
  }
}
