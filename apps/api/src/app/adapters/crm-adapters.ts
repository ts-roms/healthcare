import { Inject, Injectable } from "@nestjs/common";
import { carePlan, carePlanActivity } from "@healthcare/care-plan";
import { encounter } from "@healthcare/clinic";
import { ageInYears, DATABASE, type Database } from "@healthcare/core";
import type { CrmPreferenceWriter, CrmSegmentSource, OutreachChannel, SegmentCriteria, SegmentMember } from "@healthcare/crm";
import { displayName, patient, patientAddress, patientCommunicationPreference, PatientRecordService } from "@healthcare/patient";
import { and, eq, exists, gte, lte, notExists, sql } from "drizzle-orm";

/**
 * Outreach → patient, clinic and care plans: who matches a segment (docs/domains/crm.md). Only active records (never
 * merged, deceased or inactive); criteria are the non-clinical ones the crm library defines, so no diagnosis, result
 * or medication is read here.
 */
@Injectable()
export class AppCrmSegmentSource implements CrmSegmentSource {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async evaluate(organizationId: string, criteria: SegmentCriteria, today: string): Promise<SegmentMember[]> {
    const conditions = [eq(patient.organizationId, organizationId), eq(patient.status, "active")];
    // Age on `today`, in whole years, from the recorded birth date.
    if (criteria.ageMin !== undefined) conditions.push(lte(patient.birthDate, shiftYears(today, -criteria.ageMin)));
    if (criteria.ageMax !== undefined) conditions.push(sql`${patient.birthDate} > ${shiftYears(today, -(criteria.ageMax + 1))}`);
    if (criteria.sex) conditions.push(eq(patient.sex, criteria.sex));
    if (criteria.registeredFrom) conditions.push(gte(patient.createdAt, new Date(`${criteria.registeredFrom}T00:00:00+08:00`)));
    if (criteria.registeredTo) conditions.push(lte(patient.createdAt, new Date(`${criteria.registeredTo}T23:59:59.999+08:00`)));
    if (criteria.cityMunicipality || criteria.province) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(patientAddress)
            .where(
              and(
                eq(patientAddress.patientId, patient.id),
                eq(patientAddress.isPrimary, true),
                ...(criteria.cityMunicipality ? [sql`lower(${patientAddress.cityMunicipality}) = lower(${criteria.cityMunicipality})`] : []),
                ...(criteria.province ? [sql`lower(${patientAddress.province}) = lower(${criteria.province})`] : []),
              ),
            ),
        ),
      );
    }
    const completedVisits = (since?: Date) =>
      this.db
        .select({ one: sql`1` })
        .from(encounter)
        .where(and(eq(encounter.patientId, patient.id), eq(encounter.status, "completed"), ...(since ? [gte(encounter.startedAt, since)] : [])));
    if (criteria.lastVisitBefore) {
      // Seen at least once, and not since the day after the given date.
      conditions.push(exists(completedVisits()));
      conditions.push(notExists(completedVisits(new Date(`${criteria.lastVisitBefore}T23:59:59.999+08:00`))));
    }
    if (criteria.noVisitForMonths !== undefined) {
      conditions.push(notExists(completedVisits(new Date(`${shiftMonths(today, -criteria.noVisitForMonths)}T00:00:00+08:00`))));
    }
    if (criteria.carePlanActivityDueWithinDays !== undefined) {
      const until = shiftDays(today, criteria.carePlanActivityDueWithinDays);
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(carePlanActivity)
            .innerJoin(carePlan, eq(carePlan.id, carePlanActivity.carePlanId))
            .where(
              and(
                eq(carePlanActivity.patientId, patient.id),
                eq(carePlan.status, "active"),
                sql`${carePlanActivity.status} IN ('planned', 'scheduled')`,
                sql`${carePlanActivity.dueDate} IS NOT NULL AND ${carePlanActivity.dueDate} <= ${until}`,
              ),
            ),
        ),
      );
    }
    if (criteria.optedInChannel) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(patientCommunicationPreference)
            .where(
              and(
                eq(patientCommunicationPreference.patientId, patient.id),
                eq(patientCommunicationPreference.channel, criteria.optedInChannel),
                eq(patientCommunicationPreference.category, "outreach"),
                eq(patientCommunicationPreference.optedIn, true),
              ),
            ),
        ),
      );
    }
    const rows = await this.db
      .select({
        id: patient.id,
        patientNumber: patient.patientNumber,
        familyName: patient.familyName,
        givenName: patient.givenName,
        middleName: patient.middleName,
        suffix: patient.suffix,
        sex: patient.sex,
        birthDate: patient.birthDate,
      })
      .from(patient)
      .where(and(...conditions))
      .orderBy(patient.familyName, patient.givenName);
    return rows.map((row) => ({
      patientId: row.id,
      patientNumber: row.patientNumber,
      displayName: displayName(row),
      sex: row.sex,
      age: ageInYears(row.birthDate, today),
    }));
  }
}

/** Outreach → patient: the opt-out link records a preference the patient domain owns and audits. */
@Injectable()
export class AppCrmPreferenceWriter implements CrmPreferenceWriter {
  constructor(private readonly patients: PatientRecordService) {}

  optOut(organizationId: string, patientId: string, channel: OutreachChannel, campaignId: string): Promise<void> {
    return this.patients.recordOutreachOptOut(organizationId, patientId, channel, campaignId);
  }
}

function shiftYears(day: string, years: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function shiftMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
