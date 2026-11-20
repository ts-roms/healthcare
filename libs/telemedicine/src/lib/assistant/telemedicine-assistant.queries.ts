import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { telemedicineSession } from "../telemedicine.schema";

/**
 * What the assistant's telemedicine rule reads (in-person.rules.ts): of the pre-consult questionnaire, only the red flags
 * ticked and the number of days the symptoms lasted — never the patient's words. The API audits the request.
 */
@Injectable()
export class TelemedicineAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `telemedicine.in-person-care`: the red flags and symptom duration of the questionnaire submitted for a consultation by
   * `asOf`; null when the consultation has no online session with a questionnaire submitted by then.
   */
  async preConsultAnswers(organizationId: string, encounterId: string, asOf: Date): Promise<{ redFlags: string[]; symptomDurationDays: number | null } | null> {
    const [row] = await this.db
      .select({
        redFlags: telemedicineSession.redFlags,
        symptomDurationDays: sql<number | null>`(${telemedicineSession.questionnaire} ->> 'symptomDurationDays')::int`,
      })
      .from(telemedicineSession)
      .where(
        and(
          eq(telemedicineSession.organizationId, organizationId),
          eq(telemedicineSession.encounterId, encounterId),
          isNotNull(telemedicineSession.questionnaireSubmittedAt),
          lte(telemedicineSession.questionnaireSubmittedAt, asOf),
        ),
      )
      .limit(1);
    return row ? { redFlags: row.redFlags, symptomDurationDays: row.symptomDurationDays ?? null } : null;
  }
}
