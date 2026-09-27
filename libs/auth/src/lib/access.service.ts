import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, isNull, or } from "drizzle-orm";
import { role, roleAssignment, rolePermission } from "./auth.schema";

export interface ScopedGrant {
  facilityId: string | null;
  departmentId: string | null;
  permissionKey: string;
}

export interface AccessContext {
  facilityId?: string;
  departmentId?: string;
}

/**
 * A grant applies when its scope contains the request context:
 * organization-wide grants always apply; facility grants only in that
 * facility; department grants only in that department.
 */
export function grantApplies(grant: Pick<ScopedGrant, "facilityId" | "departmentId">, context: AccessContext): boolean {
  if (grant.facilityId !== null && grant.facilityId !== context.facilityId) return false;
  if (grant.departmentId !== null && grant.departmentId !== context.departmentId) return false;
  return true;
}

export function effectivePermissions(grants: ScopedGrant[], context: AccessContext): Set<string> {
  return new Set(grants.filter((grant) => grantApplies(grant, context)).map((grant) => grant.permissionKey));
}

@Injectable()
export class AccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async grantsFor(userId: string, organizationId: string): Promise<ScopedGrant[]> {
    return this.db
      .select({
        facilityId: roleAssignment.facilityId,
        departmentId: roleAssignment.departmentId,
        permissionKey: rolePermission.permissionKey,
      })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .innerJoin(rolePermission, eq(rolePermission.roleId, role.id))
      .where(
        and(
          eq(roleAssignment.userId, userId),
          eq(roleAssignment.organizationId, organizationId),
          isNull(roleAssignment.revokedAt),
          // Defense in depth: never honor another organization's custom role.
          or(isNull(role.organizationId), eq(role.organizationId, roleAssignment.organizationId)),
        ),
      );
  }

  async resolvePermissions(userId: string, organizationId: string, context: AccessContext): Promise<Set<string>> {
    return effectivePermissions(await this.grantsFor(userId, organizationId), context);
  }
}
