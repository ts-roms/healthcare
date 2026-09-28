import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, DomainEventPublisher } from "@healthcare/core";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import type { z } from "zod";
import type { recordPerioChartSchema } from "../dental.dto";
import { dentalPerioChart, type DentalPerioChartRecord, dentalPerioSite, dentalPerioTooth, PERIO_SITES, type PerioSite } from "../dental.schema";
import { found, rejectIssues, requireDentist, requireOpenEncounter, strip } from "../dental-support";
import { perioChanges, perioSummary, perioToothIssues } from "../periodontal.rules";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

export interface PerioSiteView {
  site: PerioSite;
  probingDepth: number | null;
  gingivalMargin: number | null;
  bleeding: boolean;
  suppuration: boolean;
  plaque: boolean;
}

export interface PerioToothView {
  tooth: string;
  mobility: number | null;
  furcation: number | null;
  sites: PerioSiteView[];
}

/**
 * Periodontal charts: per tooth six probing sites (depth, gingival margin, bleeding, suppuration, plaque), mobility
 * and furcation. Recorded by a dentist during the patient's visit, immutable (entered in error with a reason is the
 * only change). Summaries and changes since the previous chart are display aids; nothing is staged or diagnosed.
 */
@Injectable()
export class DentalPerioService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async record(actor: Actor, patientId: string, input: z.infer<typeof recordPerioChartSchema>) {
    const dentist = await requireDentist(this.context, actor);
    const encounter = await requireOpenEncounter(this.context, actor, input.encounterId, patientId);
    const issues: Record<string, string[]> = {};
    const seen = new Set<string>();
    for (const t of input.teeth) {
      if (seen.has(t.tooth)) (issues[t.tooth] ??= []).push("charted twice");
      seen.add(t.tooth);
      (issues[t.tooth] ??= []).push(...perioToothIssues(t));
    }
    rejectIssues(issues, "Some teeth are not charted correctly", "invalid_perio_chart");

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(dentalPerioChart)
        .values({
          organizationId: actor.organizationId,
          facilityId: encounter.facilityId,
          patientId,
          encounterId: encounter.id,
          practitionerId: dentist.id,
          notes: input.notes || null,
          recordedBy: actor.userId,
        })
        .returning();
      const chart = found(created, "Periodontal chart");
      for (const t of input.teeth) {
        const [row] = await tx
          .insert(dentalPerioTooth)
          .values({
            organizationId: actor.organizationId,
            patientId,
            chartId: chart.id,
            tooth: t.tooth,
            mobility: t.mobility ?? null,
            furcation: t.furcation ?? null,
          })
          .returning({ id: dentalPerioTooth.id });
        if (t.sites.length) {
          await tx.insert(dentalPerioSite).values(
            t.sites.map((s) => ({
              organizationId: actor.organizationId,
              toothId: row!.id,
              site: s.site,
              probingDepth: s.probingDepth ?? null,
              gingivalMargin: s.gingivalMargin ?? null,
              bleeding: s.bleeding,
              suppuration: s.suppuration,
              plaque: s.plaque,
            })),
          );
        }
      }
      await this.audit.record(tx, actor, {
        action: "dental.perio.record",
        resourceType: "dental_perio_chart",
        resourceId: chart.id,
        patientId,
        metadata: { encounterId: encounter.id, teeth: input.teeth.length },
      });
      await this.events.record(tx, {
        type: "DentalPerioChartRecorded",
        organizationId: actor.organizationId,
        aggregateType: "dental_perio_chart",
        aggregateId: chart.id,
        facilityId: chart.facilityId,
        patientId,
        payload: { encounterId: encounter.id, teethCharted: input.teeth.length },
      });
      return this.withTeeth(tx, chart);
    });
  }

  async markEnteredInError(actor: Actor, chartId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalPerioChart)
        .where(and(eq(dentalPerioChart.organizationId, actor.organizationId), eq(dentalPerioChart.id, chartId)))
        .for("update");
      const chart = found(current, "Periodontal chart");
      if (chart.status !== "recorded") throw new BusinessRuleError("The chart is already marked entered in error", "already_entered_in_error");
      const [row] = await tx
        .update(dentalPerioChart)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId })
        .where(eq(dentalPerioChart.id, chartId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "dental.perio.entered-in-error",
        resourceType: "dental_perio_chart",
        resourceId: chartId,
        patientId: chart.patientId,
        reason,
      });
      return strip(found(row, "Periodontal chart"));
    });
  }

  /** The patient's charts, newest first, each with its summary (entered-in-error ones flagged). */
  async forPatient(organizationId: string, patientId: string) {
    const charts = await this.db
      .select()
      .from(dentalPerioChart)
      .where(and(eq(dentalPerioChart.organizationId, organizationId), eq(dentalPerioChart.patientId, patientId)))
      .orderBy(desc(dentalPerioChart.recordedAt))
      .limit(50);
    const teeth = await this.teethOf(
      this.db,
      charts.map((c) => c.id),
    );
    return charts.map((c) => ({ ...strip(c), summary: perioSummary(teeth.get(c.id) ?? []) }));
  }

  /** Every chart of the patient with its measurements, oldest first (record exports; not audited here). */
  async withMeasurements(organizationId: string, patientId: string) {
    const charts = await this.db
      .select()
      .from(dentalPerioChart)
      .where(and(eq(dentalPerioChart.organizationId, organizationId), eq(dentalPerioChart.patientId, patientId)))
      .orderBy(asc(dentalPerioChart.recordedAt));
    const teeth = await this.teethOf(
      this.db,
      charts.map((c) => c.id),
    );
    return charts.map((c) => ({ ...strip(c), teeth: teeth.get(c.id) ?? [] }));
  }

  /**
   * One chart with its measurements, summary, and the changes since the patient's previous recorded chart (sites whose
   * probing depth changed by 2 mm or more). Viewing is audited.
   */
  async get(actor: Actor, chartId: string) {
    const [row] = await this.db
      .select()
      .from(dentalPerioChart)
      .where(and(eq(dentalPerioChart.organizationId, actor.organizationId), eq(dentalPerioChart.id, chartId)));
    const chart = found(row, "Periodontal chart");
    const [previous] = await this.db
      .select()
      .from(dentalPerioChart)
      .where(
        and(
          eq(dentalPerioChart.organizationId, actor.organizationId),
          eq(dentalPerioChart.patientId, chart.patientId),
          eq(dentalPerioChart.status, "recorded"),
          lt(dentalPerioChart.recordedAt, chart.recordedAt),
        ),
      )
      .orderBy(desc(dentalPerioChart.recordedAt))
      .limit(1);
    const teeth = await this.teethOf(this.db, [chart.id, ...(previous ? [previous.id] : [])]);
    const current = teeth.get(chart.id) ?? [];
    const names = await this.context.practitionerNames(actor.organizationId, [chart.practitionerId]);
    await this.audit.recordStandalone(actor, {
      action: "dental.perio.view",
      resourceType: "dental_perio_chart",
      resourceId: chartId,
      patientId: chart.patientId,
    });
    return {
      ...strip(chart),
      practitionerName: names.get(chart.practitionerId) ?? null,
      teeth: current,
      summary: perioSummary(current),
      previous: previous
        ? {
            id: previous.id,
            recordedAt: previous.recordedAt,
            summary: perioSummary(teeth.get(previous.id) ?? []),
            changes: perioChanges(teeth.get(previous.id) ?? [], current),
          }
        : null,
    };
  }

  private async withTeeth(executor: DbExecutor, chart: DentalPerioChartRecord) {
    const teeth = (await this.teethOf(executor, [chart.id])).get(chart.id) ?? [];
    return { ...strip(chart), teeth, summary: perioSummary(teeth) };
  }

  /** Teeth (by FDI code) with their sites in probing order, per chart. */
  private async teethOf(executor: DbExecutor, chartIds: string[]): Promise<Map<string, PerioToothView[]>> {
    const out = new Map<string, PerioToothView[]>();
    if (!chartIds.length) return out;
    const teeth = await executor.select().from(dentalPerioTooth).where(inArray(dentalPerioTooth.chartId, chartIds)).orderBy(asc(dentalPerioTooth.tooth));
    const sites = teeth.length
      ? await executor
          .select()
          .from(dentalPerioSite)
          .where(
            inArray(
              dentalPerioSite.toothId,
              teeth.map((t) => t.id),
            ),
          )
      : [];
    for (const t of teeth) {
      const view: PerioToothView = {
        tooth: t.tooth,
        mobility: t.mobility,
        furcation: t.furcation,
        sites: sites
          .filter((s) => s.toothId === t.id)
          .sort((a, b) => PERIO_SITES.indexOf(a.site) - PERIO_SITES.indexOf(b.site))
          .map((s) => ({
            site: s.site,
            probingDepth: s.probingDepth,
            gingivalMargin: s.gingivalMargin,
            bleeding: s.bleeding,
            suppuration: s.suppuration,
            plaque: s.plaque,
          })),
      };
      out.set(t.chartId, [...(out.get(t.chartId) ?? []), view]);
    }
    return out;
  }
}
