import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, PH_TIMEZONE } from "@healthcare/core";
import { and, eq, gt, lte, or, sql } from "drizzle-orm";
import type { FrequencyCap, QuietHours, SegmentCriteria } from "../crm.rules";
import { crmSegment } from "../crm.schema";
import { CrmService } from "../crm.service";
import { CRM_SEGMENT_SOURCE, type CrmSegmentSource } from "../ports";

/**
 * What the outreach assistant's rules read (outreach.rules.ts), as of a moment where the records allow it: segments,
 * campaign start times and deliveries are rebuilt from their timestamps; the organization's limits and the patients a
 * criterion matches are read as they are now. Counts and hours only, never a patient.
 */
@Injectable()
export class CrmAssistantQueries {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CRM_SEGMENT_SOURCE) private readonly source: CrmSegmentSource,
    private readonly crm: CrmService,
  ) {}

  /** The criteria of the segments active at `asOf`. An archived segment never changes again, so its last update is when it was archived. */
  async activeSegmentCriteria(organizationId: string, asOf: Date): Promise<SegmentCriteria[]> {
    const rows = await this.db
      .select({ criteria: crmSegment.criteria })
      .from(crmSegment)
      .where(
        and(
          eq(crmSegment.organizationId, organizationId),
          lte(crmSegment.createdAt, asOf),
          or(eq(crmSegment.status, "active"), gt(crmSegment.updatedAt, asOf)),
        ),
      );
    return rows.map((r) => r.criteria);
  }

  /** How many active patients the criteria match on the local day `today` (the same matching a segment preview does). */
  async countMatching(organizationId: string, criteria: SegmentCriteria, today: string): Promise<number> {
    return this.source.count(organizationId, criteria, today);
  }

  /** The local hours (Asia/Manila, like every outreach time) the most recent campaigns started at, newest first. */
  async recentSendHours(organizationId: string, asOf: Date, limit = 10): Promise<number[]> {
    const { rows } = await this.db.execute<{ hour: number }>(sql`
      SELECT extract(hour FROM started_at AT TIME ZONE ${PH_TIMEZONE})::int AS hour
      FROM crm_campaign
      WHERE organization_id = ${organizationId}::uuid AND started_at IS NOT NULL AND started_at <= ${asOf.toISOString()}::timestamptz
      ORDER BY started_at DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => Number(r.hour));
  }

  /** Patients who received at least `campaigns` outreach campaigns (queued or delivered) in the days up to `asOf`, and the most any one received. */
  async outreachLoad(
    organizationId: string,
    window: { asOf: Date; windowDays: number; campaigns: number },
  ): Promise<{ patients: number; mostReceived: number }> {
    const from = new Date(window.asOf.getTime() - window.windowDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{ patients: number; most: number }>(sql`
      SELECT count(*) FILTER (WHERE received >= ${window.campaigns})::int AS patients, coalesce(max(received), 0)::int AS most
      FROM (
        SELECT patient_id, count(DISTINCT campaign_id) AS received
        FROM crm_campaign_delivery
        WHERE organization_id = ${organizationId}::uuid
          AND outcome IN ('queued', 'delivered')
          AND created_at > ${from}::timestamptz AND created_at <= ${window.asOf.toISOString()}::timestamptz
        GROUP BY patient_id
      ) per_patient
    `);
    return { patients: Number(rows[0]?.patients ?? 0), mostReceived: Number(rows[0]?.most ?? 0) };
  }

  /** The organization's frequency cap and quiet hours as set now (null when off). */
  async limits(organizationId: string): Promise<{ cap: FrequencyCap | null; quietHours: QuietHours | null }> {
    const { cap, quiet } = await this.crm.loadLimits(organizationId);
    return { cap, quietHours: quiet ? { start: quiet.start, end: quiet.end } : null };
  }
}
