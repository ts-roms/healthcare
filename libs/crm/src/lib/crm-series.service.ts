import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  NotFoundError,
  systemActor,
  todayInPhilippines,
  VersionConflictError,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { type CampaignInput, validateWording } from "./crm.service";
import {
  canApprove,
  canSeriesTransition,
  MISSED_OCCURRENCE_GRACE_MS,
  nextOccurrence,
  occurrenceInstant,
  type Schedule,
  scheduleProblems,
  type SeriesStatus,
} from "./crm.rules";
import { crmCampaign, type CrmCampaignRecord, crmCampaignSeries, type CrmSeriesRecord, crmSegment } from "./crm.schema";

export interface SeriesInput extends Omit<CampaignInput, "sendAt"> {
  cadence: "weekly" | "monthly";
  weekday?: number | null;
  dayOfMonth?: number | null;
  /** "HH:MM", Asia/Manila time. */
  sendTime: string;
  startsOn: string;
  endsOn?: string | null;
}

export type SeriesView = CrmSeriesRecord & { segmentName: string };
export interface SeriesOccurrence {
  id: string;
  name: string;
  occurrenceOn: string;
  status: CrmCampaignRecord["status"];
  sendAt: string | null;
  completedAt: string | null;
}

const asSchedule = (s: Pick<CrmSeriesRecord, "cadence" | "weekday" | "dayOfMonth" | "sendTime" | "startsOn" | "endsOn">): Schedule => ({
  cadence: s.cadence,
  weekday: s.weekday,
  dayOfMonth: s.dayOfMonth,
  sendTime: s.sendTime,
  startsOn: s.startsOn,
  endsOn: s.endsOn,
});

/**
 * Recurring outreach (docs/domains/crm.md, "Recurring campaigns"): a series repeats one approved piece of wording and one
 * segment on a weekly or monthly schedule. Two people approve it once; each occurrence is then created as an ordinary
 * approved campaign at its time, so the segment is read at that moment, the opt-in, the frequency cap and the quiet hours
 * apply, and the results are a campaign's. Changing anything means pausing, taking it back to a draft and approving it again.
 */
@Injectable()
export class CrmSeriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly portalBase: string | undefined,
  ) {}

  async list(actor: Actor): Promise<SeriesView[]> {
    const rows = await this.db
      .select({ series: crmCampaignSeries, segmentName: crmSegment.name })
      .from(crmCampaignSeries)
      .innerJoin(crmSegment, eq(crmSegment.id, crmCampaignSeries.segmentId))
      .where(eq(crmCampaignSeries.organizationId, actor.organizationId))
      .orderBy(desc(crmCampaignSeries.createdAt));
    return rows.map((r) => ({ ...r.series, segmentName: r.segmentName }));
  }

  /** One series with its latest occurrences (each a campaign with its own page and results). */
  async get(actor: Actor, seriesId: string): Promise<{ series: SeriesView; occurrences: SeriesOccurrence[] }> {
    const [row] = await this.db
      .select({ series: crmCampaignSeries, segmentName: crmSegment.name })
      .from(crmCampaignSeries)
      .innerJoin(crmSegment, eq(crmSegment.id, crmCampaignSeries.segmentId))
      .where(and(eq(crmCampaignSeries.organizationId, actor.organizationId), eq(crmCampaignSeries.id, seriesId)));
    if (!row) throw new NotFoundError("Recurring campaign");
    const children = await this.db
      .select()
      .from(crmCampaign)
      .where(and(eq(crmCampaign.organizationId, actor.organizationId), eq(crmCampaign.seriesId, seriesId)))
      .orderBy(desc(crmCampaign.occurrenceOn))
      .limit(30);
    return {
      series: { ...row.series, segmentName: row.segmentName },
      occurrences: children.map((c) => ({
        id: c.id,
        name: c.name,
        occurrenceOn: c.occurrenceOn ?? "",
        status: c.status,
        sendAt: c.sendAt ? c.sendAt.toISOString() : null,
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
      })),
    };
  }

  async create(actor: Actor, input: SeriesInput): Promise<SeriesView> {
    const values = await this.checked(actor, input);
    return this.db.transaction(async (tx) => {
      const segment = await this.activeSegment(actor.organizationId, input.segmentId, tx);
      const [row] = await tx
        .insert(crmCampaignSeries)
        .values({ organizationId: actor.organizationId, createdBy: actor.userId, ...values })
        .returning();
      await this.audit.record(tx, actor, {
        action: "crm.series.create",
        resourceType: "crm_campaign_series",
        resourceId: row!.id,
        metadata: { segmentId: input.segmentId, cadence: row!.cadence, startsOn: row!.startsOn },
      });
      return { ...row!, segmentName: segment.name };
    });
  }

  /** Only drafts change; the change makes the caller the author. */
  async update(actor: Actor, seriesId: string, input: SeriesInput & { version: number }): Promise<SeriesView> {
    const values = await this.checked(actor, input);
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, seriesId);
      if (current.version !== input.version) throw new VersionConflictError("Recurring campaign", current.version);
      if (current.status !== "draft")
        throw new BusinessRuleError("Only a draft can be changed: pause it and take it back to a draft first", "series_not_draft");
      const segment = await this.activeSegment(actor.organizationId, input.segmentId, tx);
      const [row] = await tx
        .update(crmCampaignSeries)
        .set({ ...values, createdBy: actor.userId, version: current.version + 1, updatedAt: new Date() })
        .where(eq(crmCampaignSeries.id, seriesId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "crm.series.update",
        resourceType: "crm_campaign_series",
        resourceId: seriesId,
        changes: {
          body: { from: current.body, to: row!.body },
          segmentId: { from: current.segmentId, to: row!.segmentId },
          cadence: { from: current.cadence, to: row!.cadence },
          sendTime: { from: current.sendTime, to: row!.sendTime },
        },
      });
      return { ...row!, segmentName: segment.name };
    });
  }

  submit(actor: Actor, seriesId: string, version: number): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "submitted", () => ({
      submittedBy: actor.userId,
      submittedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
    }));
  }

  /** Back to a draft for changes (from submitted, or from paused); the approval is gone. */
  reopen(actor: Actor, seriesId: string, version: number): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "draft", () => ({
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      nextRunAt: null,
    }));
  }

  /** The second person's approval: from then on every occurrence goes out at its time. */
  approve(actor: Actor, seriesId: string, version: number): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "active", (current) => {
      if (!canApprove(current, actor.userId))
        throw new ForbiddenError("A recurring campaign is approved by someone other than its author", "approver_is_author");
      const next = nextOccurrence(asSchedule(current), new Date());
      if (!next) throw new BusinessRuleError("The schedule has no occurrence left", "no_occurrence_left");
      return { approvedBy: actor.userId, approvedAt: new Date(), nextRunAt: next };
    });
  }

  pause(actor: Actor, seriesId: string, version: number): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "paused", () => ({ nextRunAt: null }));
  }

  /** Picks up at the next occurrence after now: the ones missed while paused are not sent. */
  resume(actor: Actor, seriesId: string, version: number): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "active", (current) => {
      const next = nextOccurrence(asSchedule(current), new Date());
      if (!next) throw new BusinessRuleError("The schedule has no occurrence left", "no_occurrence_left");
      return { nextRunAt: next };
    });
  }

  end(actor: Actor, seriesId: string, version: number, reason: string): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "ended", () => ({
      nextRunAt: null,
      closedBy: actor.userId,
      closedAt: new Date(),
      closeReason: reason.trim(),
    }));
  }

  cancel(actor: Actor, seriesId: string, version: number, reason: string): Promise<SeriesView> {
    return this.transition(actor, seriesId, version, "cancelled", () => ({
      nextRunAt: null,
      closedBy: actor.userId,
      closedAt: new Date(),
      closeReason: reason.trim(),
    }));
  }

  private async transition(
    actor: Actor,
    seriesId: string,
    version: number,
    to: SeriesStatus,
    patch: (current: CrmSeriesRecord) => Partial<typeof crmCampaignSeries.$inferInsert>,
  ): Promise<SeriesView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, seriesId);
      if (current.version !== version) throw new VersionConflictError("Recurring campaign", current.version);
      if (!canSeriesTransition(current.status, to)) throw new BusinessRuleError(`A ${current.status} recurring campaign cannot become ${to}`, "series_status");
      const [row] = await tx
        .update(crmCampaignSeries)
        .set({ ...patch(current), status: to, version: current.version + 1, updatedAt: new Date() })
        .where(eq(crmCampaignSeries.id, seriesId))
        .returning();
      const action =
        to === "draft"
          ? "reopen"
          : to === "submitted"
            ? "submit"
            : to === "active"
              ? current.status === "paused"
                ? "resume"
                : "approve"
              : to === "paused"
                ? "pause"
                : to === "ended"
                  ? "end"
                  : "cancel";
      await this.audit.record(tx, actor, {
        action: `crm.series.${action}`,
        resourceType: "crm_campaign_series",
        resourceId: seriesId,
        changes: { status: { from: current.status, to } },
        ...(row!.closeReason ? { reason: row!.closeReason } : {}),
      });
      if (action === "submit" || action === "approve") {
        await this.events.record(tx, {
          type: action === "submit" ? "CrmSeriesSubmitted" : "CrmSeriesApproved",
          organizationId: actor.organizationId,
          aggregateType: "crm_campaign_series",
          aggregateId: seriesId,
          payload: { seriesId },
        });
      }
      const [segment] = await tx.select({ name: crmSegment.name }).from(crmSegment).where(eq(crmSegment.id, row!.segmentId));
      return { ...row!, segmentName: segment?.name ?? "" };
    });
  }

  // ---- the generator (the minute-by-minute runner) ---------------------------------------------------------------------

  /**
   * Creates the occurrence of every active series whose time has come, as an approved campaign the sender then takes, and
   * moves each series on. An occurrence missed by more than six hours is skipped. A series past its last day ends.
   */
  async generateDue(now = new Date()): Promise<{ created: number; skipped: number }> {
    const due = await this.db
      .select()
      .from(crmCampaignSeries)
      .where(and(eq(crmCampaignSeries.status, "active"), lte(crmCampaignSeries.nextRunAt, now)))
      .orderBy(asc(crmCampaignSeries.nextRunAt));
    let created = 0;
    let skipped = 0;
    for (const series of due) {
      const result = await this.generateOne(series.id, now);
      created += result.created;
      skipped += result.skipped;
    }
    return { created, skipped };
  }

  private async generateOne(seriesId: string, now: Date): Promise<{ created: number; skipped: number }> {
    return this.db.transaction(async (tx) => {
      const [series] = await tx.select().from(crmCampaignSeries).where(eq(crmCampaignSeries.id, seriesId)).for("update");
      if (!series || series.status !== "active" || !series.nextRunAt || series.nextRunAt.getTime() > now.getTime()) return { created: 0, skipped: 0 };
      const schedule = asSchedule(series);
      const actor = systemActor(series.organizationId, null, "outreach-series");
      let at: Date | null = series.nextRunAt;
      let skipped = 0;
      // The system was down: an occurrence long past is not sent late.
      while (at && at.getTime() < now.getTime() - MISSED_OCCURRENCE_GRACE_MS) {
        skipped += 1;
        at = nextOccurrence(schedule, at);
      }
      let created = 0;
      if (at && at.getTime() <= now.getTime()) {
        const day = todayInPhilippines(at);
        const label = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(at);
        const [child] = await tx
          .insert(crmCampaign)
          .values({
            organizationId: series.organizationId,
            segmentId: series.segmentId,
            name: `${series.name.slice(0, 90)} — ${label}`,
            channels: series.channels,
            subject: series.subject,
            body: series.body,
            includeBookingLink: series.includeBookingLink,
            deliveryMode: series.deliveryMode,
            status: "approved",
            sendAt: at,
            createdBy: series.createdBy,
            submittedBy: series.submittedBy,
            submittedAt: series.submittedAt,
            approvedBy: series.approvedBy,
            approvedAt: series.approvedAt,
            seriesId: series.id,
            occurrenceOn: day,
          })
          .onConflictDoNothing()
          .returning();
        if (child) {
          created = 1;
          await this.audit.record(tx, actor, {
            action: "crm.series.run",
            resourceType: "crm_campaign_series",
            resourceId: series.id,
            metadata: { campaignId: child.id, occurrenceOn: day, skippedBefore: skipped },
          });
        }
        at = nextOccurrence(schedule, at);
      }
      if (at) await tx.update(crmCampaignSeries).set({ nextRunAt: at, updatedAt: now }).where(eq(crmCampaignSeries.id, series.id));
      else {
        await tx
          .update(crmCampaignSeries)
          .set({ status: "ended", nextRunAt: null, closedAt: null, closeReason: "Reached its last day", version: series.version + 1, updatedAt: now })
          .where(eq(crmCampaignSeries.id, series.id));
        await this.audit.record(tx, actor, {
          action: "crm.series.end",
          resourceType: "crm_campaign_series",
          resourceId: series.id,
          reason: "Reached its last day",
        });
      }
      return { created, skipped };
    });
  }

  /** Whether any series that has not ended or been cancelled uses the segment (it cannot be archived while one does). */
  async segmentInUse(segmentId: string, db: Pick<Database, "select"> = this.db): Promise<boolean> {
    const [row] = await db
      .select({ id: crmCampaignSeries.id })
      .from(crmCampaignSeries)
      .where(and(eq(crmCampaignSeries.segmentId, segmentId), inArray(crmCampaignSeries.status, ["draft", "submitted", "active", "paused"])))
      .limit(1);
    return Boolean(row);
  }

  /** The few fields a notice needs about a series; null when it is gone. */
  async forNotice(
    organizationId: string,
    seriesId: string,
  ): Promise<{ id: string; organizationId: string; name: string; createdBy: string; submittedBy: string | null } | null> {
    const [row] = await this.db
      .select({
        id: crmCampaignSeries.id,
        organizationId: crmCampaignSeries.organizationId,
        name: crmCampaignSeries.name,
        createdBy: crmCampaignSeries.createdBy,
        submittedBy: crmCampaignSeries.submittedBy,
      })
      .from(crmCampaignSeries)
      .where(and(eq(crmCampaignSeries.organizationId, organizationId), eq(crmCampaignSeries.id, seriesId)));
    return row ?? null;
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------

  /** The wording and schedule, checked: what is stored for a draft. */
  private async checked(actor: Actor, input: SeriesInput) {
    const clinicName = (await this.organizations.getOrganization(actor.organizationId)).name;
    const wording = validateWording({ ...input, sendAt: null }, this.portalBaseUrl, clinicName);
    const schedule: Partial<Schedule> = {
      cadence: input.cadence,
      weekday: input.cadence === "weekly" ? (input.weekday ?? null) : null,
      dayOfMonth: input.cadence === "monthly" ? (input.dayOfMonth ?? null) : null,
      sendTime: input.sendTime,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
    };
    const problems = scheduleProblems({ ...schedule, weekday: input.weekday ?? null, dayOfMonth: input.dayOfMonth ?? null }, todayInPhilippines());
    if (problems.length > 0)
      throw new BusinessRuleError(
        "The schedule is not valid",
        "schedule_invalid",
        problems.map((message) => ({ message })),
      );
    const first = nextOccurrence(schedule as Schedule, new Date(occurrenceInstant(input.startsOn, "00:00").getTime() - 1));
    if (!first) throw new BusinessRuleError("The schedule never sends: no day between the first and last day matches", "no_occurrence");
    return {
      segmentId: input.segmentId,
      name: input.name.trim(),
      channels: [...new Set(input.channels)],
      subject: wording.subject,
      body: wording.body,
      includeBookingLink: input.includeBookingLink ?? false,
      deliveryMode: input.deliveryMode ?? ("all" as const),
      cadence: input.cadence,
      weekday: schedule.weekday ?? null,
      dayOfMonth: schedule.dayOfMonth ?? null,
      sendTime: input.sendTime,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
    };
  }

  private get portalBaseUrl(): string | undefined {
    return this.portalBase?.replace(/\/$/, "");
  }

  private async activeSegment(organizationId: string, segmentId: string, db: Pick<Database, "select"> = this.db) {
    const [row] = await db
      .select()
      .from(crmSegment)
      .where(and(eq(crmSegment.organizationId, organizationId), eq(crmSegment.id, segmentId)));
    if (!row) throw new NotFoundError("Segment");
    if (row.status !== "active") throw new BusinessRuleError("The segment is archived", "segment_archived");
    return row;
  }

  private async lock(tx: Database, organizationId: string, seriesId: string): Promise<CrmSeriesRecord> {
    const [row] = await tx
      .select()
      .from(crmCampaignSeries)
      .where(and(eq(crmCampaignSeries.organizationId, organizationId), eq(crmCampaignSeries.id, seriesId)))
      .for("update");
    if (!row) throw new NotFoundError("Recurring campaign");
    return row;
  }
}
