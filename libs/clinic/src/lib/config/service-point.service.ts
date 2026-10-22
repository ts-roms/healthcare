import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, type DbExecutor } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createServicePointSchema, updateServicePointSchema, updateServicePointSettingsSchema } from "../clinic.dto";
import { servicePoint, type ServicePointKind, type ServicePointRecord, servicePointSetting } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";

export type ServicePointView = Omit<ServicePointRecord, "organizationId">;

/** What queue rows and routing history say about a service point. */
export interface ServicePointBrief {
  id: string;
  code: string;
  name: string;
  kind: ServicePointKind;
  /** What the display says when a route sends a patient here (migration 0115); the name when null. */
  location: string | null;
}

/** A facility's routing settings (migration 0115); `version` is null while the facility uses the defaults. */
export interface ServicePointSettingsView {
  facilityId: string;
  autoCallOnRoute: boolean;
  seniorsFirst: boolean;
  version: number | null;
  updatedAt: Date | null;
}

const FIELDS = ["name", "kind", "status", "location"] as const;

/**
 * The organization's own service points per facility (docs/domains/clinic.md, "Service points"; migration 0113,
 * ADR-0014): the consultation line, the emergency room, X-ray … as the organization names them. Configuration only —
 * no national list, triage scale or emergency-care rule is assumed.
 */
@Injectable()
export class ServicePointService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  /** A facility's service points in kind order (consultation, emergency, imaging, other), then by name. */
  async list(actor: Actor, facilityId: string, includeInactive = false): Promise<ServicePointView[]> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    const conditions = [eq(servicePoint.organizationId, actor.organizationId), eq(servicePoint.facilityId, facilityId)];
    if (!includeInactive) conditions.push(eq(servicePoint.status, "active"));
    const rows = await this.db
      .select()
      .from(servicePoint)
      .where(and(...conditions))
      .orderBy(asc(servicePoint.name));
    return rows.sort(compareServicePoints).map(publicView);
  }

  async create(actor: Actor, input: z.infer<typeof createServicePointSchema>): Promise<ServicePointView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(servicePoint)
        .values({ ...input, organizationId: actor.organizationId, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError(`Service point code "${input.code}" is already in use at this facility`, undefined, "service_point_exists");
      await this.audit.record(tx, actor, {
        action: "service-point.create",
        resourceType: "service_point",
        resourceId: created.id,
        metadata: { facilityId: input.facilityId, code: created.code, kind: created.kind },
      });
      return publicView(created);
    });
  }

  /** Rename, change the kind, deactivate or reactivate; the code never changes (visits and history name it). */
  async update(actor: Actor, servicePointId: string, input: z.infer<typeof updateServicePointSchema>): Promise<ServicePointView> {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(servicePoint)
        .where(and(eq(servicePoint.organizationId, actor.organizationId), eq(servicePoint.id, servicePointId)))
        .for("update");
      const current = found(before, "Service point");
      assertVersion(current.version, version, "Service point");
      const [updated] = await tx
        .update(servicePoint)
        .set({ ...changes, updatedAt: new Date(), version: sql`${servicePoint.version} + 1` })
        .where(eq(servicePoint.id, servicePointId))
        .returning();
      const row = found(updated, "Service point");
      await this.audit.record(tx, actor, {
        action: "service-point.update",
        resourceType: "service_point",
        resourceId: servicePointId,
        changes: diffChanges(current, changes, FIELDS),
        metadata: { facilityId: current.facilityId, code: current.code },
      });
      return publicView(row);
    });
  }

  /** An active service point of the facility, for routing a visit to it (another facility's is "not found"). */
  async requireActive(executor: DbExecutor, organizationId: string, facilityId: string, servicePointId: string): Promise<ServicePointRecord> {
    const [row] = await executor
      .select()
      .from(servicePoint)
      .where(and(eq(servicePoint.organizationId, organizationId), eq(servicePoint.facilityId, facilityId), eq(servicePoint.id, servicePointId)));
    const current = found(row, "Service point");
    if (current.status !== "active") throw new BusinessRuleError(`${current.name} is no longer in use`, "service_point_inactive");
    return current;
  }

  /** Names for queue rows and routing history, by id (inactive ones included: a visit may still be at one). */
  async briefs(organizationId: string, ids: readonly string[], executor: DbExecutor = this.db): Promise<Map<string, ServicePointBrief>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({ id: servicePoint.id, code: servicePoint.code, name: servicePoint.name, kind: servicePoint.kind, location: servicePoint.location })
      .from(servicePoint)
      .where(and(eq(servicePoint.organizationId, organizationId), inArray(servicePoint.id, unique)));
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ---- routing settings per facility (migration 0115) ----------------------------------------------------

  /** A facility's routing settings; the defaults (nothing called automatically) without a row. */
  async settings(organizationId: string, facilityId: string, executor: DbExecutor = this.db): Promise<ServicePointSettingsView> {
    const [row] = await executor
      .select()
      .from(servicePointSetting)
      .where(and(eq(servicePointSetting.organizationId, organizationId), eq(servicePointSetting.facilityId, facilityId)));
    return {
      facilityId,
      autoCallOnRoute: row?.autoCallOnRoute ?? false,
      seniorsFirst: row?.seniorsFirst ?? false,
      version: row?.version ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async getSettings(actor: Actor, facilityId: string): Promise<ServicePointSettingsView> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    return this.settings(actor.organizationId, facilityId);
  }

  /** Sets a facility's routing settings (`version` is null while the facility still uses the defaults); audited. */
  async updateSettings(actor: Actor, input: z.infer<typeof updateServicePointSettingsSchema>): Promise<ServicePointSettingsView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(servicePointSetting)
        .where(and(eq(servicePointSetting.organizationId, actor.organizationId), eq(servicePointSetting.facilityId, input.facilityId)))
        .for("update");
      if (current) assertVersion(current.version, input.version ?? current.version, "Routing settings");
      const seniorsFirst = input.seniorsFirst ?? current?.seniorsFirst ?? false;
      const [row] = await tx
        .insert(servicePointSetting)
        .values({
          facilityId: input.facilityId,
          organizationId: actor.organizationId,
          autoCallOnRoute: input.autoCallOnRoute,
          seniorsFirst,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: servicePointSetting.facilityId,
          set: {
            autoCallOnRoute: input.autoCallOnRoute,
            seniorsFirst,
            updatedBy: actor.userId,
            updatedAt: new Date(),
            version: sql`${servicePointSetting.version} + 1`,
          },
        })
        .returning();
      const saved = found(row, "Routing settings");
      await this.audit.record(tx, actor, {
        action: "service-point-setting.update",
        resourceType: "service_point_setting",
        resourceId: input.facilityId,
        changes: {
          autoCallOnRoute: { from: current?.autoCallOnRoute ?? false, to: saved.autoCallOnRoute },
          seniorsFirst: { from: current?.seniorsFirst ?? false, to: saved.seniorsFirst },
        },
        metadata: { facilityId: input.facilityId },
      });
      return {
        facilityId: saved.facilityId,
        autoCallOnRoute: saved.autoCallOnRoute,
        seniorsFirst: saved.seniorsFirst,
        version: saved.version,
        updatedAt: saved.updatedAt,
      };
    });
  }
}

const KIND_RANK: Record<ServicePointKind, number> = { consultation: 0, emergency: 1, imaging: 2, other: 3 };

/** Kind order (consultation first, then emergency, imaging, other), then name. */
export function compareServicePoints(a: Pick<ServicePointRecord, "kind" | "name">, b: Pick<ServicePointRecord, "kind" | "name">): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name);
}
