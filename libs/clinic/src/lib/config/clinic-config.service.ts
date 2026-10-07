import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, asPgError, BusinessRuleError, ConflictError, DATABASE, type Database, NotFoundError, PgErrorCode } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  createCodingSystemSchema,
  updateCodingSystemSchema,
  createExceptionSchema,
  createPractitionerSchema,
  createRoomSchema,
  createScheduleSchema,
  createVisitTypeSchema,
  updateVisitTypeSchema,
  updatePractitionerSchema,
} from "../clinic.dto";
import { codingSystem, practitioner, practitionerSchedule, room, scheduleException, visitType } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";

const VISIT_TYPE_FIELDS = ["name", "defaultDurationMinutes", "onlineBooking", "status"] as const;
const CODING_SYSTEM_FIELDS = ["name", "version", "status"] as const;
const PRACTITIONER_FIELDS = ["displayName", "profession", "specialty", "licenseNumber", "licenseValidUntil", "userId", "status"] as const;

/** Clinic master data: practitioners, rooms, visit types, coding systems, schedules and closures. */
@Injectable()
export class ClinicConfigService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async listPractitioners(organizationId: string) {
    const rows = await this.db.select().from(practitioner).where(eq(practitioner.organizationId, organizationId)).orderBy(asc(practitioner.displayName));
    return rows.map(publicView);
  }

  async createPractitioner(actor: Actor, input: z.infer<typeof createPractitionerSchema>) {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(practitioner)
          .values({ ...input, organizationId: actor.organizationId })
          .returning();
        const row = found(created, "Practitioner");
        await this.audit.record(tx, actor, {
          action: "practitioner.create",
          resourceType: "practitioner",
          resourceId: row.id,
          metadata: { profession: row.profession, linkedUserId: row.userId },
        });
        return publicView(row);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError("That staff account is already linked to a practitioner", undefined, "user_already_linked");
      }
      throw error;
    }
  }

  async updatePractitioner(actor: Actor, practitionerId: string, input: z.infer<typeof updatePractitionerSchema>) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(practitioner)
        .where(and(eq(practitioner.organizationId, actor.organizationId), eq(practitioner.id, practitionerId)))
        .for("update");
      const current = found(before, "Practitioner");
      assertVersion(current.version, version, "Practitioner");
      const [updated] = await tx
        .update(practitioner)
        .set({ ...changes, updatedAt: new Date(), version: sql`${practitioner.version} + 1` })
        .where(eq(practitioner.id, practitionerId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "practitioner.update",
        resourceType: "practitioner",
        resourceId: practitionerId,
        changes: diffChanges(current, changes, PRACTITIONER_FIELDS),
      });
      return publicView(found(updated, "Practitioner"));
    });
  }

  async listRooms(organizationId: string, facilityId: string) {
    const rows = await this.db
      .select()
      .from(room)
      .where(and(eq(room.organizationId, organizationId), eq(room.facilityId, facilityId)))
      .orderBy(asc(room.code));
    return rows.map(publicView);
  }

  async createRoom(actor: Actor, input: z.infer<typeof createRoomSchema>) {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(room)
        .values({ ...input, organizationId: actor.organizationId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Room code "${input.code}" is already in use at this facility`);
      await this.audit.record(tx, actor, { action: "room.create", resourceType: "room", resourceId: created.id, metadata: { facilityId: input.facilityId } });
      return publicView(created);
    });
  }

  async listVisitTypes(organizationId: string) {
    const rows = await this.db.select().from(visitType).where(eq(visitType.organizationId, organizationId)).orderBy(asc(visitType.name));
    return rows.map(publicView);
  }

  async createVisitType(actor: Actor, input: z.infer<typeof createVisitTypeSchema>) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(visitType)
        .values({ ...input, organizationId: actor.organizationId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Visit type "${input.code}" already exists`);
      await this.audit.record(tx, actor, { action: "visit-type.create", resourceType: "visit_type", resourceId: created.id });
      return publicView(created);
    });
  }

  async updateVisitType(actor: Actor, visitTypeId: string, input: z.infer<typeof updateVisitTypeSchema>) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(visitType)
        .where(and(eq(visitType.organizationId, actor.organizationId), eq(visitType.id, visitTypeId)))
        .for("update");
      const current = found(before, "Visit type");
      assertVersion(current.version, version, "Visit type");
      const [updated] = await tx
        .update(visitType)
        .set({ ...changes, version: sql`${visitType.version} + 1` })
        .where(eq(visitType.id, visitTypeId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "visit-type.update",
        resourceType: "visit_type",
        resourceId: visitTypeId,
        changes: diffChanges(current, changes, VISIT_TYPE_FIELDS),
      });
      return publicView(found(updated, "Visit type"));
    });
  }

  async listCodingSystems(organizationId: string) {
    const rows = await this.db.select().from(codingSystem).where(eq(codingSystem.organizationId, organizationId)).orderBy(asc(codingSystem.key));
    return rows.map(publicView);
  }

  async createCodingSystem(actor: Actor, input: z.infer<typeof createCodingSystemSchema>) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(codingSystem)
        .values({ ...input, organizationId: actor.organizationId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Coding system "${input.key}" already exists`);
      await this.audit.record(tx, actor, { action: "coding-system.create", resourceType: "coding_system", resourceId: created.id });
      return publicView(created);
    });
  }

  /** Deactivating a system refuses new diagnoses against it; recorded diagnoses keep their code and system. */
  async updateCodingSystem(actor: Actor, codingSystemId: string, input: z.infer<typeof updateCodingSystemSchema>) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(codingSystem)
        .where(and(eq(codingSystem.organizationId, actor.organizationId), eq(codingSystem.id, codingSystemId)))
        .for("update");
      const current = found(before, "Coding system");
      const changes = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.version !== undefined ? { version: input.version || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      };
      if (Object.keys(changes).length === 0) throw new BusinessRuleError("Nothing to change (the key cannot be changed)", "nothing_to_change");
      const [updated] = await tx.update(codingSystem).set(changes).where(eq(codingSystem.id, codingSystemId)).returning();
      await this.audit.record(tx, actor, {
        action: "coding-system.update",
        resourceType: "coding_system",
        resourceId: codingSystemId,
        changes: diffChanges(current, changes, CODING_SYSTEM_FIELDS),
      });
      return publicView(found(updated, "Coding system"));
    });
  }

  async listSchedules(organizationId: string, practitionerId?: string) {
    const conditions = [eq(practitionerSchedule.organizationId, organizationId), eq(practitionerSchedule.status, "active")];
    if (practitionerId) conditions.push(eq(practitionerSchedule.practitionerId, practitionerId));
    const rows = await this.db
      .select()
      .from(practitionerSchedule)
      .where(and(...conditions))
      .orderBy(asc(practitionerSchedule.dayOfWeek), asc(practitionerSchedule.startTime));
    return rows.map(publicView);
  }

  async createSchedule(actor: Actor, input: z.infer<typeof createScheduleSchema>) {
    await this.requireActivePractitioner(actor.organizationId, input.practitionerId);
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      // Overlapping blocks for the same practitioner and weekday would produce duplicate slots.
      const overlapping = await tx
        .select({ id: practitionerSchedule.id })
        .from(practitionerSchedule)
        .where(
          and(
            eq(practitionerSchedule.practitionerId, input.practitionerId),
            eq(practitionerSchedule.dayOfWeek, input.dayOfWeek),
            eq(practitionerSchedule.status, "active"),
            sql`${practitionerSchedule.startTime} < ${input.endTime}::time AND ${practitionerSchedule.endTime} > ${input.startTime}::time`,
            or(isNull(practitionerSchedule.validUntil), gte(practitionerSchedule.validUntil, input.validFrom)),
            input.validUntil ? lte(practitionerSchedule.validFrom, input.validUntil) : sql`TRUE`,
          ),
        );
      if (overlapping.length > 0)
        throw new ConflictError("This schedule overlaps an existing one", { scheduleIds: overlapping.map((o) => o.id) }, "schedule_overlap");
      const [created] = await tx
        .insert(practitionerSchedule)
        .values({ ...input, organizationId: actor.organizationId, createdBy: actor.userId })
        .returning();
      const row = found(created, "Schedule");
      await this.audit.record(tx, actor, {
        action: "schedule.create",
        resourceType: "practitioner_schedule",
        resourceId: row.id,
        metadata: { practitionerId: input.practitionerId, facilityId: input.facilityId, dayOfWeek: input.dayOfWeek },
      });
      return publicView(row);
    });
  }

  async retireSchedule(actor: Actor, scheduleId: string) {
    return this.db.transaction(async (tx) => {
      const [retired] = await tx
        .update(practitionerSchedule)
        .set({ status: "retired", retiredAt: new Date() })
        .where(
          and(
            eq(practitionerSchedule.organizationId, actor.organizationId),
            eq(practitionerSchedule.id, scheduleId),
            eq(practitionerSchedule.status, "active"),
          ),
        )
        .returning();
      if (!retired) throw new NotFoundError("Active schedule");
      await this.audit.record(tx, actor, { action: "schedule.retire", resourceType: "practitioner_schedule", resourceId: scheduleId });
      return publicView(retired);
    });
  }

  async listExceptions(organizationId: string, facilityId: string, from: Date, to: Date) {
    const rows = await this.db
      .select()
      .from(scheduleException)
      .where(
        and(
          eq(scheduleException.organizationId, organizationId),
          eq(scheduleException.facilityId, facilityId),
          sql`tstzrange(${scheduleException.startsAt}, ${scheduleException.endsAt}) && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
        ),
      )
      .orderBy(asc(scheduleException.startsAt));
    return rows.map(publicView);
  }

  async createException(actor: Actor, input: z.infer<typeof createExceptionSchema>) {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    if (input.practitionerId) await this.requireActivePractitioner(actor.organizationId, input.practitionerId);
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scheduleException)
        .values({
          organizationId: actor.organizationId,
          facilityId: input.facilityId,
          practitionerId: input.practitionerId ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason,
          createdBy: actor.userId,
        })
        .returning();
      const row = found(created, "Schedule exception");
      await this.audit.record(tx, actor, {
        action: input.practitionerId ? "schedule.exception-create" : "facility.closure-create",
        resourceType: "schedule_exception",
        resourceId: row.id,
        reason: input.reason,
        metadata: { facilityId: input.facilityId, practitionerId: input.practitionerId },
      });
      return publicView(row);
    });
  }

  async requireActivePractitioner(organizationId: string, practitionerId: string) {
    const [row] = await this.db
      .select()
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), eq(practitioner.id, practitionerId)));
    const current = found(row, "Practitioner");
    if (current.status !== "active") throw new ConflictError("Practitioner is inactive", undefined, "practitioner_inactive");
    return current;
  }

  /** The practitioner record linked to a staff account, if any. */
  async practitionerForUser(organizationId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), eq(practitioner.userId, userId), eq(practitioner.status, "active")));
    return row;
  }

  async requireActiveVisitType(organizationId: string, visitTypeId: string) {
    const [row] = await this.db
      .select()
      .from(visitType)
      .where(and(eq(visitType.organizationId, organizationId), eq(visitType.id, visitTypeId)));
    const current = found(row, "Visit type");
    if (current.status !== "active") throw new ConflictError("Visit type is inactive", undefined, "visit_type_inactive");
    return current;
  }
}
