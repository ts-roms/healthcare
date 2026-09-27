import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@healthcare/audit';
import {
  type Actor,
  DATABASE,
  type Database,
  normalizeIdentifier,
  normalizeName,
  normalizePhMobile,
  type Page,
  pageOffset,
  toPage,
} from '@healthcare/core';
import { and, asc, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm';
import type { PatientSearchInput } from './patient.dto';
import { patient, patientContactPoint, patientIdentifier } from './patient.schema';
import { type PatientSummary, toSummary } from './patient.views';

const PATIENT_NUMBER = /^P\d{1,10}$/i;

/** How a free-text query is interpreted. Exported for tests. */
export function classifyQuery(
  q: string,
): { kind: 'patient_number'; value: string } | { kind: 'phone'; value: string } | { kind: 'name'; value: string } {
  if (PATIENT_NUMBER.test(q)) return { kind: 'patient_number', value: `P${q.slice(1).padStart(8, '0')}` };
  const digits = q.replace(/[\s().+-]/g, '');
  if (/^\d{7,15}$/.test(digits)) return { kind: 'phone', value: normalizePhMobile(q) ?? q.replace(/[^\d+]/g, '') };
  return { kind: 'name', value: normalizeName(q) };
}

@Injectable()
export class PatientSearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Patient lookup by patient number, mobile/phone, name (typo-tolerant via
   * trigrams), birth date and identifiers. Returns minimal summaries only.
   */
  async search(actor: Actor, query: PatientSearchInput): Promise<Page<PatientSummary>> {
    const filters: SQL[] = [eq(patient.organizationId, actor.organizationId)];
    if (query.includeInactive !== 'true') filters.push(notInArray(patient.status, ['inactive', 'merged']));
    let order: SQL[] = [asc(patient.familyNameNormalized), asc(patient.givenNameNormalized)];

    const interpreted = query.q ? classifyQuery(query.q) : undefined;
    if (interpreted?.kind === 'patient_number') {
      filters.push(eq(patient.patientNumber, interpreted.value));
    } else if (interpreted?.kind === 'phone') {
      filters.push(sql`EXISTS (SELECT 1 FROM ${patientContactPoint} c
        WHERE c.patient_id = ${patient.id} AND c.status = 'active' AND c.value_normalized = ${interpreted.value})`);
    } else if (interpreted?.kind === 'name') {
      const q = interpreted.value;
      filters.push(
        sql`(${patient.nameSearch} % ${q} OR ${patient.nameSearch} LIKE ${`${escapeLike(q)}%`} OR ${patient.familyNameNormalized} LIKE ${`${escapeLike(q)}%`})`,
      );
      order = [sql`similarity(${patient.nameSearch}, ${q}) DESC`, ...order];
    }
    if (query.birthDate) filters.push(eq(patient.birthDate, query.birthDate));
    if (query.identifierType && query.identifierValue) {
      filters.push(sql`EXISTS (SELECT 1 FROM ${patientIdentifier} i
        WHERE i.patient_id = ${patient.id} AND i.status = 'active'
          AND i.type = ${query.identifierType} AND i.value_normalized = ${normalizeIdentifier(query.identifierValue)})`);
    }

    const rows = await this.db
      .select()
      .from(patient)
      .where(and(...filters))
      .orderBy(...order)
      .limit(query.pageSize + 1)
      .offset(pageOffset(query));
    const page = toPage(rows, query);
    const mobiles = page.items.length
      ? await this.db
          .select({ patientId: patientContactPoint.patientId, value: patientContactPoint.valueNormalized })
          .from(patientContactPoint)
          .where(
            and(
              inArray(
                patientContactPoint.patientId,
                page.items.map((p) => p.id),
              ),
              eq(patientContactPoint.system, 'mobile'),
              eq(patientContactPoint.isPrimary, true),
              eq(patientContactPoint.status, 'active'),
            ),
          )
      : [];
    const mobileByPatient = new Map(mobiles.map((m) => [m.patientId, m.value]));

    await this.audit.recordStandalone(actor, {
      action: 'patient.search',
      resourceType: 'patient',
      metadata: {
        queryKind: interpreted?.kind,
        criteria: {
          q: query.q,
          birthDate: query.birthDate,
          identifierType: query.identifierType,
          hasIdentifierValue: Boolean(query.identifierValue),
        },
        resultCount: page.items.length,
      },
    });
    return { ...page, items: page.items.map((p) => toSummary(p, mobileByPatient.get(p.id))) };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
