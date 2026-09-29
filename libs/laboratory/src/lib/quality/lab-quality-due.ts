import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { labDepartment, labTest } from "../laboratory.schema";
import { readingOverdue } from "./quality-management.rules";
import { labCompetencyAssessment, labStorageUnit, labTemperatureReading } from "./quality-management.schema";

export interface TemperatureReadingDue {
  organizationId: string;
  facilityId: string;
  storageUnitId: string;
  code: string;
  name: string;
  /** The reading the next one is due after (null: never read). Identifies this missed reading. */
  lastReadingId: string | null;
}

export interface CompetencyReassessmentDue {
  organizationId: string;
  facilityId: string;
  /** The assessment whose next due date has passed; identifies this reassessment. */
  assessmentId: string;
  userId: string;
  areaName: string;
  nextDueOn: string;
}

/**
 * What is due across all facilities, for scheduled reminders (system-wide reads; the caller decides who hears
 * about it). The same rules as the quality pages: a reading is due once the unit's interval has passed since its
 * last reading (or since it was registered), and a reassessment once the latest assessment of an area — competent,
 * with a next due date — is past that date in the facility's time zone.
 */
@Injectable()
export class LabQualityDue {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
  ) {}

  async temperatureReadingsDue(now = new Date()): Promise<TemperatureReadingDue[]> {
    const units = await this.db
      .select()
      .from(labStorageUnit)
      .where(and(eq(labStorageUnit.status, "active"), isNotNull(labStorageUnit.readingIntervalHours)))
      .limit(5000);
    if (units.length === 0) return [];
    const latest = await this.db
      .selectDistinctOn([labTemperatureReading.storageUnitId], {
        id: labTemperatureReading.id,
        storageUnitId: labTemperatureReading.storageUnitId,
        readAt: labTemperatureReading.readAt,
      })
      .from(labTemperatureReading)
      .where(
        inArray(
          labTemperatureReading.storageUnitId,
          units.map((u) => u.id),
        ),
      )
      .orderBy(labTemperatureReading.storageUnitId, desc(labTemperatureReading.readAt));
    return units.flatMap((unit) => {
      const last = latest.find((r) => r.storageUnitId === unit.id);
      // A unit never read is due one interval after it was registered, not straight away.
      if (!readingOverdue(last?.readAt ?? unit.createdAt, unit.readingIntervalHours, now)) return [];
      return [
        {
          organizationId: unit.organizationId,
          facilityId: unit.facilityId,
          storageUnitId: unit.id,
          code: unit.code,
          name: unit.name,
          lastReadingId: last?.id ?? null,
        },
      ];
    });
  }

  async competencyReassessmentsDue(now = new Date()): Promise<CompetencyReassessmentDue[]> {
    // People with any passed due date (a day of margin for time zones); their latest assessment per area decides.
    const candidates = await this.db
      .selectDistinct({ facilityId: labCompetencyAssessment.facilityId, userId: labCompetencyAssessment.userId })
      .from(labCompetencyAssessment)
      .where(sql`${labCompetencyAssessment.nextDueOn} <= (${now.toISOString()}::timestamptz)::date + 1`)
      .limit(5000);
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select({ assessment: labCompetencyAssessment, testName: labTest.name, departmentName: labDepartment.name })
      .from(labCompetencyAssessment)
      .leftJoin(labTest, eq(labTest.id, labCompetencyAssessment.testId))
      .leftJoin(labDepartment, eq(labDepartment.id, labCompetencyAssessment.departmentId))
      .where(
        and(
          inArray(labCompetencyAssessment.userId, [...new Set(candidates.map((c) => c.userId))]),
          inArray(labCompetencyAssessment.facilityId, [...new Set(candidates.map((c) => c.facilityId))]),
        ),
      )
      .orderBy(desc(labCompetencyAssessment.assessedOn), desc(labCompetencyAssessment.recordedAt));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const a = row.assessment;
      const key = `${a.facilityId}:${a.userId}:${a.testId ? `test:${a.testId}` : `department:${a.departmentId}`}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const today = new Map<string, string>();
    const due: CompetencyReassessmentDue[] = [];
    for (const { assessment: a, testName, departmentName } of latest.values()) {
      if (a.outcome !== "competent" || !a.nextDueOn) continue;
      let date = today.get(a.facilityId);
      if (!date) {
        const facility = await this.organizations.getFacility(a.organizationId, a.facilityId);
        date = localDate(now, facility.timezone);
        today.set(a.facilityId, date);
      }
      if (a.nextDueOn >= date) continue;
      due.push({
        organizationId: a.organizationId,
        facilityId: a.facilityId,
        assessmentId: a.id,
        userId: a.userId,
        areaName: testName ?? `${departmentName ?? "Section"} (whole section)`,
        nextDueOn: a.nextDueOn,
      });
    }
    return due;
  }
}
