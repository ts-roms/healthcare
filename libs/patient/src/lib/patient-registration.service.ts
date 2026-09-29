import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  cleanText,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  normalizeIdentifier,
  normalizeName,
  requireFacilityId,
} from "@healthcare/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { normalizeContact } from "./contact-normalization";
import { assessDuplicate, type DuplicateAssessment, transposeDayMonth } from "./duplicate-detection";
import type { DuplicateCheckInput, RegisterPatientInput } from "./patient.dto";
import {
  patient,
  patientAddress,
  patientContactPoint,
  patientIdentifier,
  patientNumberSequence,
  type PatientRecord,
  patientRelationship,
} from "./patient.schema";
import { type PatientSummary, toSummary } from "./patient.views";

export interface DuplicateCandidate extends DuplicateAssessment {
  patient: PatientSummary;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  name_similarity: number;
  exact_name: boolean;
}

export function patientNameFields(input: { familyName: string; givenName: string; middleName?: string | null }) {
  const familyNameNormalized = normalizeName(input.familyName);
  const givenNameNormalized = normalizeName(input.givenName);
  const middle = input.middleName ? normalizeName(input.middleName) : "";
  return {
    familyNameNormalized,
    givenNameNormalized,
    nameSearch: [givenNameNormalized, middle, familyNameNormalized].filter(Boolean).join(" "),
  };
}

@Injectable()
export class PatientRegistrationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Candidates that may be the same person, strongest first. */
  async findDuplicates(executor: DbExecutor, organizationId: string, input: DuplicateCheckInput, excludePatientId?: string): Promise<DuplicateCandidate[]> {
    const names = patientNameFields(input);
    const shortName = `${names.givenNameNormalized} ${names.familyNameNormalized}`;
    const swapped = transposeDayMonth(input.birthDate);
    const birthYear = Number(input.birthDate.slice(0, 4));

    // An identifier or contact still held by a merged (retired) record points to its survivor.
    const resolvedFrom = new Map<string, { id: string; patientNumber: string }>();
    const identifierMatches = await this.toSurvivors(
      executor,
      organizationId,
      await this.identifierMatches(executor, organizationId, input.identifiers ?? []),
      resolvedFrom,
    );
    const contactValues = (input.contacts ?? []).flatMap((c) => {
      try {
        return [normalizeContact(c.system, c.value)];
      } catch {
        return [];
      }
    });
    const contactMatches = contactValues.length
      ? await this.toSurvivors(
          executor,
          organizationId,
          (
            await executor
              .selectDistinct({ patientId: patientContactPoint.patientId })
              .from(patientContactPoint)
              .where(
                and(
                  eq(patientContactPoint.organizationId, organizationId),
                  eq(patientContactPoint.status, "active"),
                  inArray(patientContactPoint.valueNormalized, contactValues),
                ),
              )
          ).map((r) => r.patientId),
          resolvedFrom,
        )
      : [];
    const linkedIds = [...new Set([...identifierMatches, ...contactMatches])];

    const birthDates = [input.birthDate, ...(swapped ? [swapped] : [])];
    const result = await executor.execute<CandidateRow>(sql`
      SELECT p.id,
             greatest(similarity(p.name_search, ${names.nameSearch}),
                      similarity(p.given_name_normalized || ' ' || p.family_name_normalized, ${shortName}))::float8 AS name_similarity,
             (p.given_name_normalized = ${names.givenNameNormalized} AND p.family_name_normalized = ${names.familyNameNormalized}) AS exact_name
      FROM patient p
      WHERE p.organization_id = ${organizationId}
        AND p.status <> 'merged'
        ${excludePatientId ? sql`AND p.id <> ${excludePatientId}` : sql``}
        AND (
          p.birth_date IN (${sql.join(
            birthDates.map((d) => sql`${d}::date`),
            sql`, `,
          )})
          OR (p.birth_date BETWEEN make_date(${birthYear}, 1, 1) AND make_date(${birthYear}, 12, 31) AND p.name_search % ${names.nameSearch})
          ${
            linkedIds.length
              ? sql`OR p.id IN (${sql.join(
                  linkedIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : sql``
          }
        )
      LIMIT 50`);
    if (result.rows.length === 0) return [];

    const rows = await executor
      .select()
      .from(patient)
      .where(
        inArray(
          patient.id,
          result.rows.map((r) => r.id),
        ),
      );
    const primaryMobiles = await this.primaryMobiles(
      executor,
      rows.map((r) => r.id),
    );
    const signalsById = new Map(result.rows.map((r) => [r.id, r]));

    const candidates: DuplicateCandidate[] = [];
    for (const row of rows) {
      const signals = signalsById.get(row.id);
      if (!signals) continue;
      const assessment = assessDuplicate({
        nameSimilarity: Number(signals.name_similarity),
        exactName: Boolean(signals.exact_name),
        sameBirthDate: row.birthDate === input.birthDate,
        transposedBirthDate: swapped !== undefined && row.birthDate === swapped,
        sameBirthYear: row.birthDate.startsWith(String(birthYear)),
        identifierMatch: identifierMatches.includes(row.id),
        contactMatch: contactMatches.includes(row.id),
      });
      if (assessment)
        candidates.push({ ...assessment, patient: { ...toSummary(row, primaryMobiles.get(row.id)), resolvedFrom: resolvedFrom.get(row.id) ?? null } });
    }
    const rank = { certain: 0, high: 1, possible: 2 } as const;
    return candidates.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 10);
  }

  async checkDuplicates(actor: Actor, input: DuplicateCheckInput): Promise<DuplicateCandidate[]> {
    const candidates = await this.findDuplicates(this.db, actor.organizationId, input);
    await this.audit.recordStandalone(actor, {
      action: "patient.duplicate-check",
      resourceType: "patient",
      metadata: { candidateIds: candidates.map((c) => c.patient.id) },
    });
    return candidates;
  }

  /**
   * Registers a patient. If likely duplicates exist the request is rejected
   * with the candidates, unless the caller confirms they reviewed exactly
   * those candidates and gives a reason (audited). A shared identifier
   * (e.g. the same PhilHealth PIN) can never be overridden.
   */
  async register(actor: Actor, input: RegisterPatientInput): Promise<PatientRecord> {
    const facilityId = requireFacilityId(actor);
    const contacts = input.contacts.map((c) => ({ ...c, valueNormalized: normalizeContact(c.system, c.value) }));
    const relationships = input.relationships.map((r) => ({
      ...r,
      contactNumberNormalized: r.contactNumber ? safeNormalizePhone(r.contactNumber) : undefined,
    }));

    return this.db.transaction(async (tx) => {
      const candidates = await this.findDuplicates(tx, actor.organizationId, input);
      const certain = candidates.filter((c) => c.level === "certain");
      if (certain.length > 0) {
        throw new ConflictError("An identifier is already assigned to another patient", { candidates: certain }, "identifier_in_use");
      }
      const blocking = candidates.filter((c) => c.level === "high" || c.level === "possible");
      const reviewed = new Set(input.duplicateOverride?.reviewedCandidateIds ?? []);
      const unreviewed = blocking.filter((c) => !reviewed.has(c.patient.id));
      if (unreviewed.length > 0) {
        throw new ConflictError("Possible duplicate patients found. Review them before registering.", { candidates: blocking }, "possible_duplicates");
      }
      await this.assertRelatedPatientsExist(tx, actor.organizationId, relationships.map((r) => r.relatedPatientId).filter(isDefined));

      const patientNumber = await this.allocatePatientNumber(tx, actor.organizationId);
      const [created] = await tx
        .insert(patient)
        .values({
          organizationId: actor.organizationId,
          patientNumber,
          familyName: cleanText(input.familyName),
          givenName: cleanText(input.givenName),
          middleName: input.middleName ? cleanText(input.middleName) : null,
          suffix: input.suffix ?? null,
          ...patientNameFields(input),
          sex: input.sex,
          genderIdentity: input.genderIdentity ?? null,
          birthDate: input.birthDate,
          birthDateIsEstimated: input.birthDateIsEstimated ?? false,
          civilStatus: input.civilStatus ?? null,
          nationality: input.nationality ?? null,
          occupation: input.occupation ?? null,
          registeredFacilityId: facilityId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
      if (!created) throw new Error("Patient insert returned no row");
      const base = { organizationId: actor.organizationId, patientId: created.id, createdBy: actor.userId };

      if (contacts.length) {
        await tx
          .insert(patientContactPoint)
          .values(withSinglePrimaryPerKey(contacts, (c) => c.system).map((c) => ({ ...base, ...c, use: c.use ?? "personal" })));
      }
      if (input.addresses.length) {
        await tx.insert(patientAddress).values(withSinglePrimaryPerKey(input.addresses, () => "address").map((a) => ({ ...base, ...a, use: a.use ?? "home" })));
      }
      if (input.identifiers.length) {
        await tx.insert(patientIdentifier).values(input.identifiers.map((i) => ({ ...base, ...i, valueNormalized: normalizeIdentifier(i.value) })));
      }
      if (relationships.length) {
        await tx.insert(patientRelationship).values(relationships.map((r) => ({ ...base, ...r })));
      }

      await this.audit.record(tx, actor, {
        action: "patient.register",
        resourceType: "patient",
        resourceId: created.id,
        patientId: created.id,
        metadata: { patientNumber, facilityId },
      });
      if (blocking.length > 0 && input.duplicateOverride) {
        await this.audit.record(tx, actor, {
          action: "patient.duplicate-override",
          resourceType: "patient",
          resourceId: created.id,
          patientId: created.id,
          reason: input.duplicateOverride.reason,
          metadata: { reviewedCandidateIds: blocking.map((c) => c.patient.id) },
        });
      }
      return created;
    });
  }

  /** Per-organization sequence; the row lock serializes concurrent registrations. */
  private async allocatePatientNumber(tx: DbExecutor, organizationId: string): Promise<string> {
    const [row] = await tx
      .insert(patientNumberSequence)
      .values({ organizationId, nextValue: 1 })
      .onConflictDoUpdate({ target: patientNumberSequence.organizationId, set: { nextValue: sql`${patientNumberSequence.nextValue} + 1` } })
      .returning({ value: patientNumberSequence.nextValue });
    if (!row) throw new Error("Could not allocate a patient number");
    return `P${String(row.value).padStart(8, "0")}`;
  }

  private async identifierMatches(
    executor: DbExecutor,
    organizationId: string,
    identifiers: NonNullable<DuplicateCheckInput["identifiers"]>,
  ): Promise<string[]> {
    if (identifiers.length === 0) return [];
    const matches = await executor
      .selectDistinct({ patientId: patientIdentifier.patientId })
      .from(patientIdentifier)
      .where(
        and(
          eq(patientIdentifier.organizationId, organizationId),
          eq(patientIdentifier.status, "active"),
          sql`(${patientIdentifier.type}, coalesce(${patientIdentifier.issuer}, ''), ${patientIdentifier.valueNormalized}) IN (${sql.join(
            identifiers.map((i) => sql`(${i.type}, ${i.issuer ?? ""}, ${normalizeIdentifier(i.value)})`),
            sql`, `,
          )})`,
        ),
      );
    return matches.map((m) => m.patientId);
  }

  /** Patient ids with every merged (retired) record replaced by its survivor; `resolvedFrom` notes the retired record. */
  private async toSurvivors(
    executor: DbExecutor,
    organizationId: string,
    patientIds: string[],
    resolvedFrom: Map<string, { id: string; patientNumber: string }>,
  ): Promise<string[]> {
    if (patientIds.length === 0) return [];
    const rows = await executor
      .select({ id: patient.id, patientNumber: patient.patientNumber, mergedInto: patient.mergedIntoPatientId })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), inArray(patient.id, patientIds)));
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.mergedInto) {
        ids.add(row.id);
        continue;
      }
      ids.add(row.mergedInto);
      if (!patientIds.includes(row.mergedInto) && !resolvedFrom.has(row.mergedInto))
        resolvedFrom.set(row.mergedInto, { id: row.id, patientNumber: row.patientNumber });
    }
    return [...ids];
  }

  private async primaryMobiles(executor: DbExecutor, patientIds: string[]): Promise<Map<string, string>> {
    if (patientIds.length === 0) return new Map();
    const rows = await executor
      .select({ patientId: patientContactPoint.patientId, value: patientContactPoint.valueNormalized })
      .from(patientContactPoint)
      .where(
        and(
          inArray(patientContactPoint.patientId, patientIds),
          eq(patientContactPoint.system, "mobile"),
          eq(patientContactPoint.isPrimary, true),
          eq(patientContactPoint.status, "active"),
        ),
      );
    return new Map(rows.map((r) => [r.patientId, r.value]));
  }

  private async assertRelatedPatientsExist(tx: DbExecutor, organizationId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx
      .select({ id: patient.id })
      .from(patient)
      .where(and(eq(patient.organizationId, organizationId), inArray(patient.id, ids)));
    if (found.length !== new Set(ids).size) throw new ConflictError("A related patient does not exist", undefined, "related_patient_not_found");
  }
}

/**
 * Exactly one primary per key (e.g. per contact system): the first item
 * flagged primary wins; if none is flagged, the first item of that key.
 */
export function withSinglePrimaryPerKey<T extends { isPrimary?: boolean }>(items: T[], key: (item: T) => string): Array<T & { isPrimary: boolean }> {
  const primaryIndex = new Map<string, number>();
  items.forEach((item, index) => {
    const k = key(item);
    const current = primaryIndex.get(k);
    if (current === undefined || (item.isPrimary && !items[current]?.isPrimary)) primaryIndex.set(k, index);
  });
  return items.map((item, index) => ({ ...item, isPrimary: primaryIndex.get(key(item)) === index }));
}

function safeNormalizePhone(value: string): string | undefined {
  try {
    return normalizeContact("mobile", value);
  } catch {
    return value.replace(/[^\d+]/g, "") || undefined;
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
