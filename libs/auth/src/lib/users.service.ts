import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  ForbiddenError,
  NotFoundError,
  type Permission,
  PERMISSIONS,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { appUser, organizationMembership, role, roleAssignment, rolePermission } from "./auth.schema";
import { hashPassword } from "./password";
import { SessionService } from "./session.service";
import type { createRoleSchema, createUserSchema, grantRoleSchema, updateMembershipSchema } from "./users.dto";

export interface StaffUserView {
  id: string;
  email: string;
  displayName: string;
  accountStatus: string;
  membershipStatus: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  roleAssignments: Array<{
    id: string;
    roleId: string;
    roleKey: string;
    roleName: string;
    facilityId: string | null;
    departmentId: string | null;
  }>;
}

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly sessions: SessionService,
  ) {}

  /** Display names of this organization's staff (for "entered by" / "verified by" labels). Not audited. */
  async displayNames(organizationId: string, userIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (userIds.length === 0) return names;
    const rows = await this.db
      .select({ id: appUser.id, displayName: appUser.displayName })
      .from(organizationMembership)
      .innerJoin(appUser, eq(appUser.id, organizationMembership.userId))
      .where(and(eq(organizationMembership.organizationId, organizationId), inArray(appUser.id, userIds)));
    for (const row of rows) names.set(row.id, row.displayName);
    return names;
  }

  async list(organizationId: string): Promise<StaffUserView[]> {
    const members = await this.db
      .select({
        id: appUser.id,
        email: appUser.email,
        displayName: appUser.displayName,
        accountStatus: appUser.status,
        membershipStatus: organizationMembership.status,
        mfaEnabled: appUser.mfaEnabled,
        lastLoginAt: appUser.lastLoginAt,
      })
      .from(organizationMembership)
      .innerJoin(appUser, eq(appUser.id, organizationMembership.userId))
      .where(eq(organizationMembership.organizationId, organizationId))
      .orderBy(asc(appUser.displayName));
    if (members.length === 0) return [];
    const assignments = await this.db
      .select({
        id: roleAssignment.id,
        userId: roleAssignment.userId,
        roleId: role.id,
        roleKey: role.key,
        roleName: role.name,
        facilityId: roleAssignment.facilityId,
        departmentId: roleAssignment.departmentId,
      })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(
        and(
          eq(roleAssignment.organizationId, organizationId),
          isNull(roleAssignment.revokedAt),
          inArray(
            roleAssignment.userId,
            members.map((m) => m.id),
          ),
        ),
      );
    return members.map((member) => ({
      ...member,
      roleAssignments: assignments.filter((a) => a.userId === member.id).map(({ userId: _userId, ...rest }) => rest),
    }));
  }

  /**
   * Adds a staff member to the organization. An email that already has a
   * platform account is added as a member without touching its credentials.
   */
  async create(actor: Actor, input: z.infer<typeof createUserSchema>): Promise<StaffUserView> {
    const passwordHash = input.initialPassword ? await hashPassword(input.initialPassword) : undefined;
    const userId = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(appUser).where(eq(appUser.email, input.email));
      let id = existing?.id;
      if (!existing) {
        if (!passwordHash) throw new BusinessRuleError("initialPassword is required for a new account", "initial_password_required");
        const [created] = await tx.insert(appUser).values({ email: input.email, displayName: input.displayName, passwordHash }).returning({ id: appUser.id });
        id = created?.id;
      }
      if (!id) throw new Error("User insert returned no row");
      const [membership] = await tx
        .insert(organizationMembership)
        .values({ organizationId: actor.organizationId, userId: id })
        .onConflictDoNothing()
        .returning();
      if (!membership) throw new ConflictError("This person is already a member of the organization", undefined, "already_member");
      await this.audit.record(tx, actor, {
        action: "user.add-member",
        resourceType: "app_user",
        resourceId: id,
        metadata: { email: input.email, newAccount: !existing },
      });
      return id;
    });
    return this.get(actor.organizationId, userId);
  }

  async get(organizationId: string, userId: string): Promise<StaffUserView> {
    const user = (await this.list(organizationId)).find((u) => u.id === userId);
    if (!user) throw new NotFoundError("User");
    return user;
  }

  async updateMembership(actor: Actor, userId: string, input: z.infer<typeof updateMembershipSchema>): Promise<StaffUserView> {
    if (userId === actor.userId) throw new BusinessRuleError("You cannot change your own membership status", "self_modification");
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(organizationMembership)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)))
        .returning();
      if (!updated) throw new NotFoundError("User");
      const revoked = input.status === "suspended" ? await this.sessions.revokeAllForUser(tx, userId, "membership_suspended") : 0;
      await this.audit.record(tx, actor, {
        action: "user.membership-status",
        resourceType: "app_user",
        resourceId: userId,
        reason: input.reason,
        metadata: { status: input.status, sessionsRevoked: revoked },
      });
    });
    return this.get(actor.organizationId, userId);
  }

  async grantRole(actor: Actor, userId: string, input: z.infer<typeof grantRoleSchema>): Promise<StaffUserView> {
    const targetRole = await this.findUsableRole(actor.organizationId, input.roleId);
    await this.assertCanDelegate(actor, targetRole.permissions);
    if (input.facilityId) {
      const facility = await this.organizations.findFacility(actor.organizationId, input.facilityId);
      if (!facility) throw new NotFoundError("Facility");
      if (input.departmentId && !(await this.organizations.findDepartment(actor.organizationId, input.facilityId, input.departmentId))) {
        throw new NotFoundError("Department");
      }
    }
    await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(organizationMembership)
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)));
      if (!membership) throw new NotFoundError("User");
      const [created] = await tx
        .insert(roleAssignment)
        .values({
          organizationId: actor.organizationId,
          userId,
          roleId: targetRole.id,
          facilityId: input.facilityId ?? null,
          departmentId: input.departmentId ?? null,
          grantedBy: actor.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError("The user already has this role in this scope", undefined, "role_already_granted");
      await this.audit.record(tx, actor, {
        action: "user.role-grant",
        resourceType: "role_assignment",
        resourceId: created.id,
        metadata: { userId, roleKey: targetRole.key, facilityId: input.facilityId, departmentId: input.departmentId },
      });
    });
    return this.get(actor.organizationId, userId);
  }

  async revokeRole(actor: Actor, userId: string, assignmentId: string, reason: string | undefined): Promise<StaffUserView> {
    await this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(roleAssignment)
        .set({ revokedAt: new Date(), revokedBy: actor.userId })
        .where(
          and(
            eq(roleAssignment.id, assignmentId),
            eq(roleAssignment.userId, userId),
            eq(roleAssignment.organizationId, actor.organizationId),
            isNull(roleAssignment.revokedAt),
          ),
        )
        .returning();
      if (!revoked) throw new NotFoundError("Role assignment");
      await this.audit.record(tx, actor, {
        action: "user.role-revoke",
        resourceType: "role_assignment",
        resourceId: assignmentId,
        reason,
        metadata: { userId, roleId: revoked.roleId },
      });
    });
    return this.get(actor.organizationId, userId);
  }

  async listRoles(organizationId: string): Promise<RoleView[]> {
    const roles = await this.db
      .select()
      .from(role)
      .where(or(isNull(role.organizationId), eq(role.organizationId, organizationId)))
      .orderBy(asc(role.name));
    const grants = roles.length
      ? await this.db
          .select()
          .from(rolePermission)
          .where(
            inArray(
              rolePermission.roleId,
              roles.map((r) => r.id),
            ),
          )
      : [];
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: grants
        .filter((g) => g.roleId === r.id)
        .map((g) => g.permissionKey)
        .sort(),
    }));
  }

  async createRole(actor: Actor, input: z.infer<typeof createRoleSchema>): Promise<RoleView> {
    await this.assertCanDelegate(actor, input.permissions);
    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(role)
        .values({ organizationId: actor.organizationId, key: input.key, name: input.name, description: input.description })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Role key "${input.key}" is already in use`);
      await tx.insert(rolePermission).values([...new Set(input.permissions)].map((permissionKey) => ({ roleId: created.id, permissionKey })));
      await this.audit.record(tx, actor, {
        action: "role.create",
        resourceType: "role",
        resourceId: created.id,
        metadata: { key: input.key, permissions: input.permissions },
      });
      return created.id;
    });
    const created = (await this.listRoles(actor.organizationId)).find((r) => r.id === id);
    if (!created) throw new NotFoundError("Role");
    return created;
  }

  listPermissions(): readonly Permission[] {
    return PERMISSIONS;
  }

  private async findUsableRole(organizationId: string, roleId: string): Promise<RoleView> {
    const found = (await this.listRoles(organizationId)).find((r) => r.id === roleId);
    if (!found) throw new NotFoundError("Role");
    return found;
  }

  /** Prevents privilege escalation: you can only hand out permissions you hold. */
  private async assertCanDelegate(actor: Actor, permissions: readonly string[]): Promise<void> {
    const beyond = permissions.filter((p) => !actor.permissions.has(p));
    if (beyond.length > 0 && !actor.isPlatformAdmin) {
      await this.audit.recordStandalone(actor, {
        action: "access.deny",
        resourceType: "role",
        outcome: "denied",
        reason: "privilege_escalation",
        metadata: { permissions: beyond },
      });
      throw new ForbiddenError("You cannot grant permissions you do not hold");
    }
  }
}
