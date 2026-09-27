import { Injectable } from "@nestjs/common";
import { type Actor, BadRequestError, ForbiddenError, type RequestMetadata, UnauthenticatedError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { AccessService } from "./access.service";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { TokenService } from "./tokens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActorContextRequest {
  facilityId?: string;
  departmentId?: string;
}

/**
 * Turns an access token plus requested facility/department context into an
 * Actor with effective permissions. Used by the HTTP guard and the realtime
 * gateway so both authenticate identically.
 */
@Injectable()
export class ActorResolver {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly organizations: OrganizationService,
  ) {}

  async resolve(accessToken: string, context: ActorContextRequest, request: RequestMetadata): Promise<Actor> {
    const claims = await this.tokens.verifyAccessToken(accessToken);
    const session = await this.sessions.findActive(claims.sid);
    if (!session || session.userId !== claims.sub || session.organizationId !== claims.org) {
      throw new UnauthenticatedError("Session has ended", "session_ended");
    }
    const user = await this.auth.getUser(claims.sub);
    if (user.status !== "active" || !(await this.auth.hasActiveMembership(user.id, claims.org))) {
      throw new UnauthenticatedError("Account access has been revoked", "access_revoked");
    }
    const facilityId = await this.resolveFacility(context.facilityId, claims.org);
    const departmentId = await this.resolveDepartment(context.departmentId, claims.org, facilityId);
    const permissions = await this.access.resolvePermissions(user.id, claims.org, { facilityId, departmentId });
    return {
      kind: "user",
      userId: user.id,
      displayName: user.displayName,
      sessionId: session.id,
      organizationId: claims.org,
      facilityId,
      isPlatformAdmin: user.isPlatformAdmin,
      permissions,
      request,
    };
  }

  private async resolveFacility(facilityId: string | undefined, organizationId: string): Promise<string | undefined> {
    if (!facilityId) return undefined;
    if (!UUID.test(facilityId)) throw new BadRequestError("X-Facility-Id must be a UUID", "invalid_facility");
    const facility = await this.organizations.findFacility(organizationId, facilityId);
    if (!facility || facility.status !== "active") throw new ForbiddenError("Facility is not accessible");
    return facility.id;
  }

  private async resolveDepartment(departmentId: string | undefined, organizationId: string, facilityId: string | undefined): Promise<string | undefined> {
    if (!departmentId) return undefined;
    if (!facilityId) throw new BadRequestError("X-Department-Id requires X-Facility-Id", "facility_required");
    if (!UUID.test(departmentId)) throw new BadRequestError("X-Department-Id must be a UUID", "invalid_department");
    const department = await this.organizations.findDepartment(organizationId, facilityId, departmentId);
    if (!department || department.status !== "active") throw new ForbiddenError("Department is not accessible");
    return department.id;
  }
}
