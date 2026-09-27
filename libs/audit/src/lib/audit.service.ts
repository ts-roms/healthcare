import { Inject, Injectable } from "@nestjs/common";
import { type Actor, DATABASE, type Database, type DbExecutor, type Page, pageOffset, type PageQuery, type RequestMetadata, toPage } from "@healthcare/core";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { type AuditChanges, auditEvent, type AuditOutcome } from "./audit.schema";

export interface AuditEntry {
  /** Dotted verb, e.g. "patient.view", "auth.login". */
  action: string;
  resourceType: string;
  resourceId?: string;
  patientId?: string;
  outcome?: AuditOutcome;
  reason?: string;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
}

/** For events without an authenticated actor, e.g. a failed login. */
export interface AnonymousAuditContext {
  kind: "anonymous";
  /** Claimed (not yet proven) identity, e.g. the account a login attempt targeted. */
  userId?: string;
  /** Set once credentials are verified but before an Actor exists (successful login). */
  authenticated?: true;
  organizationId?: string;
  request: RequestMetadata;
}

/** A patient acting through the patient portal (not a staff user). */
export interface PatientAuditContext {
  kind: "patient";
  /** The patient portal account (recorded as the actor). */
  accountId: string;
  patientId: string;
  organizationId: string;
  request: RequestMetadata;
}

export type AuditActor = Actor | AnonymousAuditContext | PatientAuditContext;

export interface AuditQuery extends PageQuery {
  patientId?: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  /** ISO 8601 date-time. */
  from?: string;
  to?: string;
}

export type AuditEventRecord = typeof auditEvent.$inferSelect;

/**
 * Append-only audit trail. Pass the transaction of the change being audited so
 * the change and its audit record commit (or roll back) together.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(executor: DbExecutor, actor: AuditActor, entry: AuditEntry): Promise<void> {
    const isAnonymous = actor.kind === "anonymous";
    const isPatient = actor.kind === "patient";
    await executor.insert(auditEvent).values({
      organizationId: actor.organizationId ?? null,
      facilityId: isAnonymous || isPatient ? null : (actor.facilityId ?? null),
      actorType: isAnonymous ? (actor.authenticated ? "user" : "anonymous") : actor.kind,
      actorUserId: isAnonymous ? (actor.userId ?? null) : isPatient ? actor.accountId : actor.kind === "user" ? actor.userId : null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      patientId: entry.patientId ?? (isPatient ? actor.patientId : null),
      outcome: entry.outcome ?? "success",
      reason: entry.reason ?? null,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
      requestId: actor.request.requestId ?? null,
      ipAddress: actor.request.ipAddress ?? null,
      userAgent: actor.request.userAgent?.slice(0, 512) ?? null,
    });
  }

  /** Convenience for audits outside a business transaction (reads, denials). */
  recordStandalone(actor: AuditActor, entry: AuditEntry): Promise<void> {
    return this.record(this.db, actor, entry);
  }

  async list(organizationId: string, query: AuditQuery): Promise<Page<AuditEventRecord>> {
    const filters: SQL[] = [eq(auditEvent.organizationId, organizationId)];
    if (query.patientId) filters.push(eq(auditEvent.patientId, query.patientId));
    if (query.actorUserId) filters.push(eq(auditEvent.actorUserId, query.actorUserId));
    if (query.resourceType) filters.push(eq(auditEvent.resourceType, query.resourceType));
    if (query.resourceId) filters.push(eq(auditEvent.resourceId, query.resourceId));
    if (query.action) filters.push(eq(auditEvent.action, query.action));
    if (query.from) filters.push(gte(auditEvent.occurredAt, new Date(query.from)));
    if (query.to) filters.push(lte(auditEvent.occurredAt, new Date(query.to)));
    const rows = await this.db
      .select()
      .from(auditEvent)
      .where(and(...filters))
      .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
      .limit(query.pageSize + 1)
      .offset(pageOffset(query));
    return toPage(rows, query);
  }
}

/**
 * Field-level before/after for the given keys, omitting unchanged values.
 * Values are compared structurally so dates and nested objects diff correctly.
 */
export function diffChanges<T extends object>(before: T, after: { [K in keyof T]?: T[K] | null }, keys: ReadonlyArray<keyof T & string>): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from: from ?? null, to: to ?? null };
    }
  }
  return changes;
}
