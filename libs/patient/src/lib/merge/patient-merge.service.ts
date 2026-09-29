import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  ageInYears,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  todayInPhilippines,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient, patientConsent, patientContactPoint, patientIdentifier, type PatientRecord } from "../patient.schema";
import { displayName } from "../patient.views";
import { patientPortalAccount, patientPortalSession } from "../portal/portal.schema";
import type { mergePatientSchema, unmergePatientSchema } from "./patient-merge.dto";
import {
  canUnmerge,
  MERGE_INELIGIBILITY_MESSAGES,
  type MergeDifference,
  mergeDifferences,
  type MergeIneligibility,
  mergeIneligibility,
  type MergeWorkItem,
  type PortalAccountHandling,
  portalAccountHandling,
  splitWorkItems,
  unacknowledgedDifferences,
} from "./patient-merge.rules";
import { patientMerge, type PatientMergeRecord } from "./patient-merge.schema";
import { PATIENT_MERGE_CONTEXT, type PatientMergeContext } from "./ports";

/** One record as reviewed side by side: identification and administrative state, nothing clinical. */
export interface MergeRecordView {
  id: string;
  patientNumber: string;
  displayName: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: string;
  birthDate: string;
  age: number;
  status: string;
  deceasedAt: string | null;
  registeredFacilityId: string;
  createdAt: string;
  version: number;
  identifiers: Array<{ type: string; value: string; issuer: string | null }>;
  contacts: Array<{ system: string; value: string; isPrimary: boolean }>;
  portalAccount: { status: string } | null;
  /** Latest decision per consent type. */
  consents: Array<{ consentType: string; decision: string; recordedAt: string }>;
  /** Records already merged into this one. */
  mergedRecords: Array<{ id: string; patientNumber: string }>;
}

export interface MergePreview {
  retired: MergeRecordView;
  survivor: MergeRecordView;
  /** Why this pair cannot be merged at all; null when it can (once blockers are resolved). */
  ineligibility: { code: MergeIneligibility; message: string } | null;
  differences: MergeDifference[];
  /** Work in progress under the record to retire: finish, cancel or rebook each first. */
  blockers: MergeWorkItem[];
  /** Shown but not blocking. */
  warnings: MergeWorkItem[];
  portalAccount: PortalAccountHandling;
  /** Records merged into the record to retire: they are re-pointed to the survivor (chains stay flat). */
  repointed: Array<{ id: string; patientNumber: string }>;
  canMerge: boolean;
}

export interface MergeHistoryEntry {
  id: string;
  action: "merged" | "unmerged" | "repointed";
  retired: { id: string; patientNumber: string };
  survivor: { id: string; patientNumber: string };
  reason: string;
  performedAt: string;
  performedBy: { id: string; name: string | null };
  relatedMergeId: string | null;
}

export interface MergeOutcome {
  mergeId: string;
  retiredPatientId: string;
  survivorPatientId: string;
  portalAccount: PortalAccountHandling;
  repointed: string[];
}

export interface UnmergeOutcome {
  unmergeId: string;
  retiredPatientId: string;
  survivorPatientId: string;
  restoredStatus: string;
  /** Whether a MyHealth account moved at the merge went back to the restored record. */
  portalAccountReturned: boolean;
  repointed: string[];
}

interface MergeSnapshot {
  retired?: { patientNumber: string; version: number; status: string };
  survivor?: { patientNumber: string; version: number; status: string };
  differences?: string[];
  acknowledged?: string[];
  portalAccount?: { handling: PortalAccountHandling; accountId: string | null; previousStatus: string | null };
  repointedFrom?: string;
}

const MERGED_REASON = "merged";

/**
 * Patient merge, "link, don't move" (ADR-0009): the duplicate (retired record) is marked merged into the surviving
 * record; nothing filed under it is rewritten, so every patient view reads both and an unmerge is exact.
 */
@Injectable()
export class PatientMergeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    @Inject(PATIENT_MERGE_CONTEXT) private readonly context: PatientMergeContext,
  ) {}

  /** Both records side by side, flagged differences and blockers. Viewing is audited. */
  async preview(actor: Actor, retiredId: string, survivorId: string): Promise<MergePreview> {
    const [retired, survivor] = await Promise.all([this.find(this.db, actor.organizationId, retiredId), this.find(this.db, actor.organizationId, survivorId)]);
    const [retiredView, survivorView, identifiers, work] = await Promise.all([
      this.recordView(retired),
      this.recordView(survivor),
      this.identifierFacts([retired.id, survivor.id]),
      this.context.workInProgress(actor.organizationId, retired.id),
    ]);
    const ineligibility = mergeIneligibility(retired, survivor) ?? null;
    const differences = mergeDifferences(retired, survivor, {
      retired: identifiers.filter((i) => i.patientId === retired.id),
      survivor: identifiers.filter((i) => i.patientId === survivor.id),
    });
    const { blockers, warnings } = splitWorkItems(work);
    await this.audit.recordStandalone(actor, {
      action: "patient.merge-preview",
      resourceType: "patient",
      resourceId: retired.id,
      patientId: retired.id,
      metadata: { retiredPatientId: retired.id, survivorPatientId: survivor.id, blockers: blockers.length, differences: differences.map((d) => d.code) },
    });
    return {
      retired: retiredView,
      survivor: survivorView,
      ineligibility: ineligibility ? { code: ineligibility, message: MERGE_INELIGIBILITY_MESSAGES[ineligibility] } : null,
      differences,
      blockers,
      warnings,
      portalAccount: portalAccountHandling(retiredView.portalAccount ?? undefined, survivorView.portalAccount ?? undefined),
      repointed: retiredView.mergedRecords,
      canMerge: !ineligibility && blockers.length === 0,
    };
  }

  async merge(actor: Actor, retiredId: string, input: z.infer<typeof mergePatientSchema>): Promise<MergeOutcome> {
    if (retiredId === input.survivorPatientId) throw new BusinessRuleError(MERGE_INELIGIBILITY_MESSAGES.same_record, "same_record");
    const outcome = await this.db.transaction(async (tx) => {
      // Lock both records (in id order, so two opposite merges cannot deadlock). New care filed under either waits.
      const locked = await this.lockPatients(tx, actor.organizationId, [retiredId, input.survivorPatientId]);
      const retired = locked.get(retiredId);
      const survivor = locked.get(input.survivorPatientId);
      if (!retired || !survivor) throw new NotFoundError("Patient");
      const ineligible = mergeIneligibility(retired, survivor);
      if (ineligible) throw new BusinessRuleError(MERGE_INELIGIBILITY_MESSAGES[ineligible], ineligible);
      if (retired.version !== input.retiredVersion) throw new VersionConflictError("Patient", input.retiredVersion);
      if (survivor.version !== input.survivorVersion) throw new VersionConflictError("Patient", input.survivorVersion);

      const identifiers = await this.identifierFacts([retired.id, survivor.id], tx);
      const differences = mergeDifferences(retired, survivor, {
        retired: identifiers.filter((i) => i.patientId === retired.id),
        survivor: identifiers.filter((i) => i.patientId === survivor.id),
      });
      const missing = unacknowledgedDifferences(differences, input.acknowledgedDifferences);
      if (missing.length > 0) {
        throw new BusinessRuleError("Review and acknowledge every flagged difference before merging", "differences_not_acknowledged", { differences: missing });
      }
      const { blockers } = splitWorkItems(await this.context.workInProgress(actor.organizationId, retired.id));
      if (blockers.length > 0) {
        throw new ConflictError("Finish, cancel or rebook the work in progress under this record first", { blockers }, "merge_blocked");
      }

      // Portal accounts: moved to the survivor when only the retired record has one; otherwise the retired one is disabled.
      const accounts = await tx
        .select()
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), inArray(patientPortalAccount.patientId, [retired.id, survivor.id])));
      const retiredAccount = accounts.find((a) => a.patientId === retired.id);
      const handling = portalAccountHandling(
        retiredAccount,
        accounts.find((a) => a.patientId === survivor.id),
      );

      const repoint = await tx
        .select({ id: patient.id, patientNumber: patient.patientNumber })
        .from(patient)
        .where(and(eq(patient.organizationId, actor.organizationId), eq(patient.mergedIntoPatientId, retired.id)))
        .for("update");

      const snapshot: MergeSnapshot = {
        retired: { patientNumber: retired.patientNumber, version: retired.version, status: retired.status },
        survivor: { patientNumber: survivor.patientNumber, version: survivor.version, status: survivor.status },
        differences: differences.map((d) => d.code),
        acknowledged: input.acknowledgedDifferences,
        portalAccount: { handling, accountId: retiredAccount?.id ?? null, previousStatus: retiredAccount?.status ?? null },
      };
      const [merge] = await tx
        .insert(patientMerge)
        .values({
          organizationId: actor.organizationId,
          retiredPatientId: retired.id,
          survivorPatientId: survivor.id,
          action: "merged",
          previousStatus: retired.status as "active" | "inactive" | "deceased",
          reason: input.reason,
          snapshot: snapshot as Record<string, unknown>,
          performedBy: actor.userId,
        })
        .returning();
      if (!merge) throw new Error("Merge insert returned no row");

      // Flat chains: records merged into the retired record now point to the survivor.
      if (repoint.length > 0) {
        await tx
          .update(patient)
          .set({ mergedIntoPatientId: survivor.id, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
          .where(
            inArray(
              patient.id,
              repoint.map((r) => r.id),
            ),
          );
        await tx.insert(patientMerge).values(
          repoint.map((r) => ({
            organizationId: actor.organizationId,
            retiredPatientId: r.id,
            survivorPatientId: survivor.id,
            action: "repointed" as const,
            reason: input.reason,
            relatedMergeId: merge.id,
            snapshot: { repointedFrom: retired.id } as Record<string, unknown>,
            performedBy: actor.userId,
          })),
        );
      }
      await tx
        .update(patient)
        .set({ status: "merged", mergedIntoPatientId: survivor.id, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, retired.id));
      await tx
        .update(patient)
        .set({ updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, survivor.id));

      if (retiredAccount && handling === "moved_to_survivor") {
        await tx.update(patientPortalAccount).set({ patientId: survivor.id, updatedAt: new Date() }).where(eq(patientPortalAccount.id, retiredAccount.id));
        await this.revokeSessions(tx, retiredAccount.id, "patient_merged");
      } else if (retiredAccount && handling === "retired_disabled") {
        await tx
          .update(patientPortalAccount)
          .set({ status: "disabled", disabledAt: new Date(), disabledBy: actor.userId, disabledReason: MERGED_REASON, updatedAt: new Date() })
          .where(eq(patientPortalAccount.id, retiredAccount.id));
        await this.revokeSessions(tx, retiredAccount.id, "patient_merged");
      }

      const metadata = {
        mergeId: merge.id,
        retiredPatientId: retired.id,
        survivorPatientId: survivor.id,
        retiredPatientNumber: retired.patientNumber,
        survivorPatientNumber: survivor.patientNumber,
        acknowledgedDifferences: input.acknowledgedDifferences,
        portalAccount: handling,
        repointedPatientIds: repoint.map((r) => r.id),
      };
      for (const patientId of [retired.id, survivor.id]) {
        await this.audit.record(tx, actor, {
          action: "patient.merge",
          resourceType: "patient",
          resourceId: patientId,
          patientId,
          reason: input.reason,
          changes:
            patientId === retired.id ? { status: { from: retired.status, to: "merged" }, mergedIntoPatientId: { from: null, to: survivor.id } } : undefined,
          metadata,
        });
      }
      await this.events.record(tx, {
        type: "PatientMerged",
        organizationId: actor.organizationId,
        aggregateType: "patient",
        aggregateId: retired.id,
        patientId: survivor.id,
        payload: { mergeId: merge.id, retiredPatientId: retired.id, survivorPatientId: survivor.id, repointedPatientIds: repoint.map((r) => r.id) },
      });
      return { mergeId: merge.id, retiredPatientId: retired.id, survivorPatientId: survivor.id, portalAccount: handling, repointed: repoint.map((r) => r.id) };
    });
    return outcome;
  }

  /**
   * Undoes the latest merge of a retired record: its previous status comes back and the link is cleared. Records that
   * were re-pointed because of that merge go back to it; a MyHealth account moved at the merge returns if it is still
   * on the survivor. Anything filed under the survivor since the merge stays there.
   */
  async unmerge(actor: Actor, retiredId: string, input: z.infer<typeof unmergePatientSchema>): Promise<UnmergeOutcome> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(patient)
        .where(and(eq(patient.organizationId, actor.organizationId), eq(patient.id, retiredId)));
      if (!current) throw new NotFoundError("Patient");
      if (!current.mergedIntoPatientId) throw new BusinessRuleError("This record is not merged", "not_merged");
      const locked = await this.lockPatients(tx, actor.organizationId, [retiredId, current.mergedIntoPatientId]);
      const retired = locked.get(retiredId);
      const survivorId = retired?.mergedIntoPatientId;
      const survivor = survivorId ? locked.get(survivorId) : undefined;
      if (!retired || !survivor) throw new ConflictError("The record changed while it was being unmerged; reload and try again", undefined, "merge_changed");

      const history = await tx
        .select()
        .from(patientMerge)
        .where(and(eq(patientMerge.organizationId, actor.organizationId), eq(patientMerge.retiredPatientId, retired.id)))
        .orderBy(desc(patientMerge.performedAt), desc(patientMerge.id));
      if (!canUnmerge(retired.status, history[0]?.action)) throw new BusinessRuleError("This record's latest merge cannot be undone", "not_unmergeable");
      const merge = history.find((h) => h.action === "merged");
      if (!merge?.previousStatus) throw new BusinessRuleError("This record's latest merge cannot be undone", "not_unmergeable");
      const snapshot = merge.snapshot as MergeSnapshot;

      const [unmerge] = await tx
        .insert(patientMerge)
        .values({
          organizationId: actor.organizationId,
          retiredPatientId: retired.id,
          survivorPatientId: survivor.id,
          action: "unmerged",
          previousStatus: merge.previousStatus,
          reason: input.reason,
          snapshot: { mergeId: merge.id },
          performedBy: actor.userId,
        })
        .returning();
      if (!unmerge) throw new Error("Unmerge insert returned no row");

      // Records re-pointed to the survivor because this record was merged, still there: back to this record.
      const repointedByMerge = await tx
        .select({ retiredPatientId: patientMerge.retiredPatientId, performedAt: patientMerge.performedAt, id: patientMerge.id })
        .from(patientMerge)
        .where(and(eq(patientMerge.organizationId, actor.organizationId), eq(patientMerge.relatedMergeId, merge.id), eq(patientMerge.action, "repointed")));
      const candidates = [...new Set(repointedByMerge.map((r) => r.retiredPatientId))];
      const back: string[] = [];
      if (candidates.length > 0) {
        const rows = await tx
          .select({ id: patient.id })
          .from(patient)
          .where(and(inArray(patient.id, candidates), eq(patient.mergedIntoPatientId, survivor.id)))
          .for("update");
        for (const row of rows) {
          // Only when that re-point is still the record's latest history entry.
          const [latest] = await tx
            .select({ id: patientMerge.id, relatedMergeId: patientMerge.relatedMergeId })
            .from(patientMerge)
            .where(eq(patientMerge.retiredPatientId, row.id))
            .orderBy(desc(patientMerge.performedAt), desc(patientMerge.id))
            .limit(1);
          if (latest?.relatedMergeId === merge.id) back.push(row.id);
        }
      }
      // The restored record first (the flat-chain check runs at commit, when both are consistent).
      await tx
        .update(patient)
        .set({ status: merge.previousStatus, mergedIntoPatientId: null, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, retired.id));
      if (back.length > 0) {
        await tx
          .update(patient)
          .set({ mergedIntoPatientId: retired.id, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
          .where(inArray(patient.id, back));
        await tx.insert(patientMerge).values(
          back.map((id) => ({
            organizationId: actor.organizationId,
            retiredPatientId: id,
            survivorPatientId: retired.id,
            action: "repointed" as const,
            reason: input.reason,
            relatedMergeId: unmerge.id,
            snapshot: { repointedFrom: survivor.id } as Record<string, unknown>,
            performedBy: actor.userId,
          })),
        );
      }
      await tx
        .update(patient)
        .set({ updatedAt: new Date(), updatedBy: actor.userId, version: sql`${patient.version} + 1` })
        .where(eq(patient.id, survivor.id));

      let portalAccountReturned = false;
      const movedAccountId = snapshot.portalAccount?.handling === "moved_to_survivor" ? snapshot.portalAccount.accountId : null;
      if (movedAccountId) {
        const [ownAccount] = await tx
          .select({ id: patientPortalAccount.id })
          .from(patientPortalAccount)
          .where(and(eq(patientPortalAccount.organizationId, actor.organizationId), eq(patientPortalAccount.patientId, retired.id)));
        const moved = ownAccount
          ? []
          : await tx
              .update(patientPortalAccount)
              .set({ patientId: retired.id, updatedAt: new Date() })
              .where(and(eq(patientPortalAccount.id, movedAccountId), eq(patientPortalAccount.patientId, survivor.id)))
              .returning({ id: patientPortalAccount.id });
        if (moved.length > 0) {
          portalAccountReturned = true;
          await this.revokeSessions(tx, movedAccountId, "patient_unmerged");
        }
      }

      const metadata = {
        unmergeId: unmerge.id,
        mergeId: merge.id,
        retiredPatientId: retired.id,
        survivorPatientId: survivor.id,
        restoredStatus: merge.previousStatus,
        portalAccountReturned,
        repointedPatientIds: back,
      };
      for (const patientId of [retired.id, survivor.id]) {
        await this.audit.record(tx, actor, {
          action: "patient.unmerge",
          resourceType: "patient",
          resourceId: patientId,
          patientId,
          reason: input.reason,
          changes:
            patientId === retired.id
              ? { status: { from: "merged", to: merge.previousStatus }, mergedIntoPatientId: { from: survivor.id, to: null } }
              : undefined,
          metadata,
        });
      }
      await this.events.record(tx, {
        type: "PatientUnmerged",
        organizationId: actor.organizationId,
        aggregateType: "patient",
        aggregateId: retired.id,
        patientId: retired.id,
        payload: { unmergeId: unmerge.id, mergeId: merge.id, retiredPatientId: retired.id, survivorPatientId: survivor.id, repointedPatientIds: back },
      });
      return {
        unmergeId: unmerge.id,
        retiredPatientId: retired.id,
        survivorPatientId: survivor.id,
        restoredStatus: merge.previousStatus,
        portalAccountReturned,
        repointed: back,
      };
    });
  }

  /** Merge history of a record: as the retired record and as the survivor, newest first. */
  async history(actor: Actor, patientId: string): Promise<MergeHistoryEntry[]> {
    await this.find(this.db, actor.organizationId, patientId);
    const rows = await this.db
      .select()
      .from(patientMerge)
      .where(
        and(
          eq(patientMerge.organizationId, actor.organizationId),
          or(eq(patientMerge.retiredPatientId, patientId), eq(patientMerge.survivorPatientId, patientId)),
        ),
      )
      .orderBy(desc(patientMerge.performedAt), desc(patientMerge.id))
      .limit(100);
    return this.historyViews(actor.organizationId, rows);
  }

  /** The latest merge that retired this record (for the "Merged into … on … by …" banner), if it is merged. */
  async latestMerge(organizationId: string, retiredId: string): Promise<MergeHistoryEntry | undefined> {
    const rows = await this.db
      .select()
      .from(patientMerge)
      .where(and(eq(patientMerge.organizationId, organizationId), eq(patientMerge.retiredPatientId, retiredId)))
      .orderBy(desc(patientMerge.performedAt), desc(patientMerge.id))
      .limit(1);
    return (await this.historyViews(organizationId, rows))[0];
  }

  private async historyViews(organizationId: string, rows: PatientMergeRecord[]): Promise<MergeHistoryEntry[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.flatMap((r) => [r.retiredPatientId, r.survivorPatientId]))];
    const [numbers, names] = await Promise.all([
      this.db.select({ id: patient.id, patientNumber: patient.patientNumber }).from(patient).where(inArray(patient.id, ids)),
      this.context.staffNames(organizationId, [...new Set(rows.map((r) => r.performedBy))]),
    ]);
    const numberOf = new Map(numbers.map((n) => [n.id, n.patientNumber]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      retired: { id: r.retiredPatientId, patientNumber: numberOf.get(r.retiredPatientId) ?? "" },
      survivor: { id: r.survivorPatientId, patientNumber: numberOf.get(r.survivorPatientId) ?? "" },
      reason: r.reason,
      performedAt: r.performedAt.toISOString(),
      performedBy: { id: r.performedBy, name: names.get(r.performedBy) ?? null },
      relatedMergeId: r.relatedMergeId,
    }));
  }

  private async find(executor: DbExecutor, organizationId: string, patientId: string): Promise<PatientRecord> {
    const [row] = await executor
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), eq(patient.id, patientId)));
    if (!row) throw new NotFoundError("Patient");
    return row;
  }

  private async lockPatients(tx: DbExecutor, organizationId: string, ids: string[]): Promise<Map<string, PatientRecord>> {
    const rows = await tx
      .select()
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), inArray(patient.id, ids)))
      .orderBy(asc(patient.id))
      .for("update");
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async identifierFacts(patientIds: string[], executor: DbExecutor = this.db) {
    return executor
      .select({
        patientId: patientIdentifier.patientId,
        type: patientIdentifier.type,
        issuer: patientIdentifier.issuer,
        valueNormalized: patientIdentifier.valueNormalized,
      })
      .from(patientIdentifier)
      .where(and(inArray(patientIdentifier.patientId, patientIds), eq(patientIdentifier.status, "active")));
  }

  private async recordView(record: PatientRecord): Promise<MergeRecordView> {
    const [identifiers, contacts, [account], consents, merged] = await Promise.all([
      this.db
        .select()
        .from(patientIdentifier)
        .where(and(eq(patientIdentifier.patientId, record.id), eq(patientIdentifier.status, "active"))),
      this.db
        .select()
        .from(patientContactPoint)
        .where(and(eq(patientContactPoint.patientId, record.id), eq(patientContactPoint.status, "active"))),
      this.db
        .select({ status: patientPortalAccount.status })
        .from(patientPortalAccount)
        .where(and(eq(patientPortalAccount.organizationId, record.organizationId), eq(patientPortalAccount.patientId, record.id))),
      this.db
        .selectDistinctOn([patientConsent.consentType])
        .from(patientConsent)
        .where(eq(patientConsent.patientId, record.id))
        .orderBy(patientConsent.consentType, desc(patientConsent.recordedAt), desc(patientConsent.id)),
      this.db
        .select({ id: patient.id, patientNumber: patient.patientNumber })
        .from(patient)
        .where(and(eq(patient.organizationId, record.organizationId), eq(patient.mergedIntoPatientId, record.id)))
        .orderBy(asc(patient.patientNumber)),
    ]);
    return {
      id: record.id,
      patientNumber: record.patientNumber,
      displayName: displayName(record),
      familyName: record.familyName,
      givenName: record.givenName,
      middleName: record.middleName,
      suffix: record.suffix,
      sex: record.sex,
      birthDate: record.birthDate,
      age: ageInYears(record.birthDate, todayInPhilippines()),
      status: record.status,
      deceasedAt: record.deceasedAt?.toISOString() ?? null,
      registeredFacilityId: record.registeredFacilityId,
      createdAt: record.createdAt.toISOString(),
      version: record.version,
      identifiers: identifiers.map((i) => ({ type: i.type, value: i.value, issuer: i.issuer })),
      contacts: contacts.map((c) => ({ system: c.system, value: c.value, isPrimary: c.isPrimary })),
      portalAccount: account ? { status: account.status } : null,
      consents: consents.map((c) => ({ consentType: c.consentType, decision: c.decision, recordedAt: c.recordedAt.toISOString() })),
      mergedRecords: merged,
    };
  }

  private async revokeSessions(tx: DbExecutor, accountId: string, reason: string): Promise<void> {
    await tx
      .update(patientPortalSession)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(patientPortalSession.accountId, accountId), isNull(patientPortalSession.revokedAt)));
  }
}
