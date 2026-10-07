import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPlatform,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  ForbiddenError,
  NotFoundError,
  type Permission,
  PERMISSIONS,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { appUser, organizationMembership, role, roleAssignment, rolePermission } from "./auth.schema";
import { assertPasswordAccepted, BREACHED_PASSWORD_CHECKER, type BreachedPasswordChecker } from "./breached-passwords";
import { hashPassword } from "./password";
import { SessionService } from "./session.service";
import type { createRoleSchema, createUserSchema, grantRoleSchema, resetPasswordSchema, updateMembershipSchema, updateRoleSchema } from "./users.dto";

export interface StaffUserView {
  id: string;
  email: string;
  displayName: string;
  accountStatus: string;
  membershipStatus: string;
  mfaEnabled: boolean;
  /** Has a temporary password from an administrator that is not yet replaced. */
  passwordChangeRequired: boolean;
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
  /** Optimistic lock for edits (migration 0102); built-in roles carry it too but cannot be edited. */
  version: number;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly sessions: SessionService,
    @Inject(BREACHED_PASSWORD_CHECKER) private readonly breachedPasswords: BreachedPasswordChecker,
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

  /**
   * Active staff who hold a permission at a facility (through an organization-wide or that facility's role), e.g. the
   * laboratory's result-entering staff for competency records. Names only; not audited.
   */
  /** Active staff holding a permission at a facility (organization-wide or that facility's roles); null: any role in the organization. */
  async holdersOf(organizationId: string, permission: string, facilityId: string | null): Promise<Array<{ id: string; displayName: string }>> {
    return this.db
      .selectDistinct({ id: appUser.id, displayName: appUser.displayName })
      .from(roleAssignment)
      .innerJoin(rolePermission, eq(rolePermission.roleId, roleAssignment.roleId))
      .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
      .innerJoin(
        organizationMembership,
        and(eq(organizationMembership.userId, roleAssignment.userId), eq(organizationMembership.organizationId, roleAssignment.organizationId)),
      )
      .where(
        and(
          eq(roleAssignment.organizationId, organizationId),
          isNull(roleAssignment.revokedAt),
          eq(rolePermission.permissionKey, permission),
          eq(organizationMembership.status, "active"),
          eq(appUser.status, "active"),
          facilityId === null ? undefined : or(isNull(roleAssignment.facilityId), eq(roleAssignment.facilityId, facilityId)),
        ),
      )
      .orderBy(asc(appUser.displayName));
  }

  /** Active members holding a role (by key) in the organization, at a facility or everywhere (for routing notices). */
  async holdersOfRole(organizationId: string, roleKey: string, facilityId: string | null): Promise<Array<{ id: string; displayName: string }>> {
    return this.db
      .selectDistinct({ id: appUser.id, displayName: appUser.displayName })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
      .innerJoin(
        organizationMembership,
        and(eq(organizationMembership.userId, roleAssignment.userId), eq(organizationMembership.organizationId, roleAssignment.organizationId)),
      )
      .where(
        and(
          eq(roleAssignment.organizationId, organizationId),
          isNull(roleAssignment.revokedAt),
          eq(role.key, roleKey),
          or(isNull(role.organizationId), eq(role.organizationId, organizationId)),
          eq(organizationMembership.status, "active"),
          eq(appUser.status, "active"),
          facilityId === null ? undefined : or(isNull(roleAssignment.facilityId), eq(roleAssignment.facilityId, facilityId)),
        ),
      )
      .orderBy(asc(appUser.displayName));
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
        passwordChangeRequired: appUser.passwordChangeRequired,
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
    if (input.initialPassword) {
      // Screened only when it will be used: an email that already has an account keeps its own password.
      const [known] = await this.db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, input.email));
      if (!known) await assertPasswordAccepted(this.breachedPasswords, input.initialPassword, this.logger);
    }
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

  /**
   * Gives a member a temporary password (the administrator hands it over directly) that must be replaced at the next
   * sign-in: every session ends, a lockout is cleared, and until the person chooses a new password the API refuses all
   * but their own account routes (migration 0090). Audited with the reason.
   */
  async resetPassword(actor: Actor, userId: string, input: z.infer<typeof resetPasswordSchema>): Promise<StaffUserView> {
    await assertPasswordAccepted(this.breachedPasswords, input.temporaryPassword, this.logger);
    const passwordHash = await hashPassword(input.temporaryPassword);
    await this.db.transaction(async (tx) => {
      await this.lockResettable(tx, actor, userId);
      await tx
        .update(appUser)
        .set({
          passwordHash,
          passwordChangedAt: new Date(),
          passwordChangeRequired: true,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
          version: sql`${appUser.version} + 1`,
        })
        .where(eq(appUser.id, userId));
      const revoked = await this.sessions.revokeAllForUser(tx, userId, "password_reset");
      await this.audit.record(tx, actor, {
        action: "user.password-reset",
        resourceType: "app_user",
        resourceId: userId,
        reason: input.reason,
        metadata: { sessionsRevoked: revoked },
      });
    });
    return this.get(actor.organizationId, userId);
  }

  /**
   * A member of the actor's organization whose sign-in this organization may reset: not the actor (My account is for
   * that), and — unless the actor is a platform administrator — an account used only in this organization and not a
   * platform administrator's, because a staff account's credentials are shared by every organization it belongs to.
   */
  private async lockResettable(tx: DbExecutor, actor: Actor, userId: string) {
    if (userId === actor.userId) throw new BusinessRuleError("Change your own sign-in under My account", "self_modification");
    const [user] = await tx.select().from(appUser).where(eq(appUser.id, userId)).for("update");
    const [member] = await tx
      .select({ userId: organizationMembership.userId })
      .from(organizationMembership)
      .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, userId)));
    if (!user || !member) throw new NotFoundError("User");
    if (!actor.isPlatformAdmin) {
      // Memberships in other organizations are outside this request's row-level security context (0111): read them
      // on their own connection under the platform scope, or this check would never find one.
      const [elsewhere] = await asPlatform("check whether an account is shared with other organizations", async () =>
        this.db
          .select({ organizationId: organizationMembership.organizationId })
          .from(organizationMembership)
          .where(and(eq(organizationMembership.userId, userId), ne(organizationMembership.organizationId, actor.organizationId)))
          .limit(1),
      );
      if (elsewhere || user.isPlatformAdmin) {
        throw new BusinessRuleError("This account is also used outside your organization; a platform administrator resets it", "account_shared");
      }
    }
    return user;
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
      version: r.version,
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
  /**
   * Edits an organization's own role (migration 0102): name, description and the whole permission set, together. A
   * built-in role is refused; the editor must hold every permission they add and every one they take away (the rule
   * for granting, applied to the change); a stale version is refused. Holders see the change at their next request.
   */
  async updateRole(actor: Actor, roleId: string, input: z.infer<typeof updateRoleSchema>): Promise<RoleView> {
    const [current] = await this.db
      .select()
      .from(role)
      .where(and(eq(role.id, roleId), or(isNull(role.organizationId), eq(role.organizationId, actor.organizationId))));
    if (!current) throw new NotFoundError("Role");
    if (current.isSystem) throw new BusinessRuleError("Built-in roles cannot be changed", "system_role");
    const before = (await this.db.select().from(rolePermission).where(eq(rolePermission.roleId, roleId))).map((g) => g.permissionKey).sort();
    const after: string[] = [...new Set<string>(input.permissions)].sort();
    const added = after.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !after.includes(p));
    await this.assertCanDelegate(actor, [...added, ...removed]);
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select({ version: role.version }).from(role).where(eq(role.id, roleId)).for("update");
      if (locked?.version !== input.version)
        throw new ConflictError("The role was changed by someone else; reload and try again", undefined, "version_conflict");
      await tx
        .update(role)
        .set({ name: input.name, description: input.description ?? null, updatedAt: new Date(), version: sql`${role.version} + 1` })
        .where(eq(role.id, roleId));
      if (removed.length) await tx.delete(rolePermission).where(and(eq(rolePermission.roleId, roleId), inArray(rolePermission.permissionKey, removed)));
      if (added.length) await tx.insert(rolePermission).values(added.map((permissionKey) => ({ roleId, permissionKey })));
      await this.audit.record(tx, actor, {
        action: "role.update",
        resourceType: "role",
        resourceId: roleId,
        reason: input.reason,
        changes: {
          name: { from: current.name, to: input.name },
          description: { from: current.description, to: input.description ?? null },
          permissions: { from: before, to: after },
        },
        metadata: { added, removed },
      });
    });
    const updated = (await this.listRoles(actor.organizationId)).find((r) => r.id === roleId);
    if (!updated) throw new NotFoundError("Role");
    return updated;
  }

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
