import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  NotFoundError,
  randomToken,
  sha256Hex,
  systemActor,
  todayInPhilippines,
  VersionConflictError,
} from "@healthcare/core";
import { AuditService } from "@healthcare/audit";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  bookingLinkText,
  bookingLinkUrl,
  canApprove,
  canTransition,
  capReached,
  approvalReminderDue,
  type ChannelReach,
  type DeliveryMode,
  firstAvailableChannel,
  firstNameOf,
  type FrequencyCap,
  isDueToSend,
  OPT_OUT_TOKEN_DAYS,
  plannedChannels,
  prioritized,
  type QuietHours,
  quietHoldUntil,
  type ReachSummary,
  renderWording,
  type SegmentCriteria,
  segmentCriteriaSchema,
  summarizeReach,
  wordingProblems,
} from "./crm.rules";
import {
  type CampaignStatus,
  crmCampaign,
  crmCampaignDelivery,
  type CrmCampaignRecord,
  crmOptOutToken,
  crmSegment,
  type CrmSegmentRecord,
  crmSetting,
  type DeliveryOutcome,
  OUTREACH_CHANNELS,
  type OutreachChannel,
} from "./crm.schema";
import {
  CRM_PREFERENCES,
  CRM_REACH_SOURCE,
  CRM_SEGMENT_SOURCE,
  type CrmPreferenceWriter,
  type CrmReachSource,
  type CrmSegmentSource,
  type SegmentMember,
} from "./ports";

export interface SegmentInput {
  name: string;
  description?: string | null;
  criteria: SegmentCriteria;
}

export interface CampaignInput {
  segmentId: string;
  name: string;
  channels: OutreachChannel[];
  subject?: string | null;
  body: string;
  sendAt?: string | null;
  /** End the message with a link to book a visit in MyHealth. */
  includeBookingLink?: boolean;
  /** Every channel named (default), or one message per patient on the first channel that reaches them. */
  deliveryMode?: DeliveryMode;
}

export interface CampaignSummary {
  patients: number;
  /** Messages queued to go out when quiet hours end (not yet sent). */
  heldForQuietHours: number;
  byChannel: Array<{ channel: OutreachChannel; queued: number; delivered: number; suppressed: number; failed: number }>;
  suppressedByReason: Array<{ reason: string; total: number }>;
}

/** The organization's limits on how often and when outreach goes out (off until an administrator sets them). */
export interface CrmSettingsView {
  frequencyCap: FrequencyCap | null;
  quietHours: { enabled: boolean; start: string | null; end: string | null; channels: Array<"sms" | "email" | "push"> };
  /** 0 until first saved. */
  version: number;
  updatedAt: string | null;
}

export interface CrmSettingsInput {
  frequencyCap: FrequencyCap | null;
  quietHours: { enabled: boolean; start: string | null; end: string | null; channels: Array<"sms" | "email" | "push"> };
  version: number;
}

/** Who a draft campaign can reach now, and what the organization's limits would do to it. */
export interface CampaignReach extends ReachSummary {
  frequencyCap: (FrequencyCap & { heldBack: number }) | null;
  quietHours: { start: string; end: string; channels: OutreachChannel[]; holdingNow: boolean; until: string | null } | null;
  includeBookingLink: boolean;
  deliveryMode: DeliveryMode;
  /** One message per patient only: how many patients each channel would carry, and how many no channel reaches. */
  plannedChannels: { byChannel: Array<{ channel: OutreachChannel; total: number }>; none: number } | null;
}

export type SegmentView = CrmSegmentRecord;
export type CampaignView = CrmCampaignRecord & { segmentName: string; summary: CampaignSummary | null };

const PREVIEW_LIMIT = 200;
const SEND_BATCH = 100;
/** Patients whose reach is checked in one preview (each check runs the same consent test a send does). */
const REACH_LIMIT = 2000;
const REACH_CONCURRENCY = 20;
/** The delivery reasons the cap and quiet hours leave in the append-only record. */
export const REASON_FREQUENCY_CAP = "frequency_cap";
export const REASON_QUIET_HOURS = "held_for_quiet_hours";

/**
 * Outreach the organization plans (docs/domains/crm.md): segments from non-clinical criteria, campaigns a second
 * person approves, deliveries through NotificationService (category "outreach", so each patient's explicit opt-in per
 * channel decides), and the opt-out link. This library reads no patient, clinic or care-plan table: the composition
 * root answers who matches a segment and records an opt-out.
 */
@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CRM_SEGMENT_SOURCE) private readonly source: CrmSegmentSource,
    @Inject(CRM_PREFERENCES) private readonly preferences: CrmPreferenceWriter,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly portalBase: string | undefined,
    @Inject(CRM_REACH_SOURCE) private readonly reachSource: CrmReachSource,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- segments ------------------------------------------------------------------------------------------------------

  async listSegments(actor: Actor): Promise<SegmentView[]> {
    return this.db.select().from(crmSegment).where(eq(crmSegment.organizationId, actor.organizationId)).orderBy(crmSegment.status, crmSegment.name);
  }

  async createSegment(actor: Actor, input: SegmentInput): Promise<SegmentView> {
    const criteria = parseCriteria(input.criteria);
    await this.checkFacility(actor.organizationId, criteria);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(crmSegment)
        .values({
          organizationId: actor.organizationId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          criteria,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, { action: "crm.segment.create", resourceType: "crm_segment", resourceId: row!.id, metadata: { criteria } });
      return row!;
    });
  }

  async updateSegment(actor: Actor, segmentId: string, input: SegmentInput & { version: number }): Promise<SegmentView> {
    const criteria = parseCriteria(input.criteria);
    await this.checkFacility(actor.organizationId, criteria);
    return this.db.transaction(async (tx) => {
      const current = await this.lockSegment(tx, actor.organizationId, segmentId);
      if (current.version !== input.version) throw new VersionConflictError("Segment", current.version);
      if (current.status === "archived") throw new BusinessRuleError("An archived segment cannot change", "segment_archived");
      const [row] = await tx
        .update(crmSegment)
        .set({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          criteria,
          version: current.version + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(crmSegment.id, segmentId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "crm.segment.update",
        resourceType: "crm_segment",
        resourceId: segmentId,
        changes: { criteria: { from: current.criteria, to: criteria }, name: { from: current.name, to: row!.name } },
      });
      return row!;
    });
  }

  /** A facility named in the criteria must be one of this organization's (a stranger's id would otherwise just match nobody). */
  private async checkFacility(organizationId: string, criteria: SegmentCriteria): Promise<void> {
    if (criteria.registeredFacilityId) await this.organizations.getFacility(organizationId, criteria.registeredFacilityId);
  }

  async archiveSegment(actor: Actor, segmentId: string, version: number): Promise<SegmentView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockSegment(tx, actor.organizationId, segmentId);
      if (current.version !== version) throw new VersionConflictError("Segment", current.version);
      const [open] = await tx
        .select({ id: crmCampaign.id })
        .from(crmCampaign)
        .where(and(eq(crmCampaign.segmentId, segmentId), inArray(crmCampaign.status, ["draft", "submitted", "approved", "sending"])))
        .limit(1);
      if (open) throw new BusinessRuleError("A segment with an open campaign cannot be archived", "segment_in_use");
      const [row] = await tx
        .update(crmSegment)
        .set({ status: "archived", version: current.version + 1, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(crmSegment.id, segmentId))
        .returning();
      await this.audit.record(tx, actor, { action: "crm.segment.archive", resourceType: "crm_segment", resourceId: segmentId });
      return row!;
    });
  }

  /** Who matches now: a count and the first members as a work list (number, name, sex, age). Audited. */
  async previewSegment(actor: Actor, segmentId: string): Promise<{ total: number; members: SegmentMember[]; truncated: boolean; reach: ReachSummary }> {
    const segment = await this.getSegment(actor.organizationId, segmentId);
    const members = await this.source.evaluate(actor.organizationId, segment.criteria, todayInPhilippines());
    // Who of them can actually be messaged, on each channel, by the same checks a send makes.
    const reach = await this.reachOf(actor.organizationId, members, [...OUTREACH_CHANNELS]);
    await this.audit.recordStandalone(actor, {
      action: "crm.segment.preview",
      resourceType: "crm_segment",
      resourceId: segmentId,
      metadata: { total: members.length, listed: Math.min(members.length, PREVIEW_LIMIT), reachableOnAny: reach.reachableOnAny },
    });
    // The work list shows number, name, sex and age; the given name kept for wording variables never leaves the server.
    const listed = members
      .slice(0, PREVIEW_LIMIT)
      .map(({ patientId, patientNumber, displayName, sex, age }) => ({ patientId, patientNumber, displayName, sex, age }));
    return { total: members.length, members: listed, truncated: members.length > PREVIEW_LIMIT, reach };
  }

  /**
   * Who this campaign can reach, on its own channels, and what the organization's limits would do to it now: patients the
   * frequency cap would hold back, and whether quiet hours would hold the text messages and push notices. Counts only.
   */
  async campaignReach(actor: Actor, campaignId: string): Promise<CampaignReach> {
    const campaign = await this.getCampaign(actor, campaignId);
    const segment = await this.getSegment(actor.organizationId, campaign.segmentId);
    const now = new Date();
    const members = await this.source.evaluate(actor.organizationId, segment.criteria, todayInPhilippines(now));
    const results = await this.reachResults(actor.organizationId, members, campaign.channels);
    const reach = summarizeReach(campaign.channels, results, members.length);
    const { cap, quiet } = await this.loadLimits(actor.organizationId);
    let frequencyCap: CampaignReach["frequencyCap"] = null;
    if (cap) {
      const recent = await this.recentCampaignCounts(
        actor.organizationId,
        members.slice(0, REACH_LIMIT).map((m) => m.patientId),
        cap.windowDays,
        campaign.id,
        now,
      );
      frequencyCap = { ...cap, heldBack: [...recent.values()].filter((n) => capReached(n, cap)).length };
    }
    let quietHours: CampaignReach["quietHours"] = null;
    if (quiet) {
      const channels = campaign.channels.filter((c) => quiet.channels.includes(c as "sms" | "email" | "push"));
      if (channels.length > 0) {
        const until = quietHoldUntil(now, quiet);
        quietHours = { start: quiet.start, end: quiet.end, channels, holdingNow: until !== null, until: until ? until.toISOString() : null };
      }
    }
    await this.audit.recordStandalone(actor, {
      action: "crm.campaign.reach",
      resourceType: "crm_campaign",
      resourceId: campaignId,
      metadata: { total: members.length, reachableOnAny: reach.reachableOnAny, heldByCap: frequencyCap?.heldBack ?? 0 },
    });
    return {
      ...reach,
      frequencyCap,
      quietHours,
      includeBookingLink: campaign.includeBookingLink,
      deliveryMode: campaign.deliveryMode,
      plannedChannels: campaign.deliveryMode === "first_available" ? plannedChannels(campaign.channels, results) : null,
    };
  }

  private async reachOf(organizationId: string, members: SegmentMember[], channels: OutreachChannel[]): Promise<ReachSummary> {
    return summarizeReach(channels, await this.reachResults(organizationId, members, channels), members.length);
  }

  /** What the consent checks say for each of the first REACH_LIMIT patients on each channel. */
  private async reachResults(
    organizationId: string,
    members: SegmentMember[],
    channels: OutreachChannel[],
  ): Promise<Array<Partial<Record<OutreachChannel, ChannelReach>>>> {
    const checked = members.slice(0, REACH_LIMIT);
    const results: Array<Partial<Record<OutreachChannel, ChannelReach>>> = [];
    for (let i = 0; i < checked.length; i += REACH_CONCURRENCY) {
      const chunk = await this.reachSource.reach(
        organizationId,
        checked.slice(i, i + REACH_CONCURRENCY).map((m) => m.patientId),
        channels,
      );
      results.push(...chunk.map((c) => c.channels));
    }
    return results;
  }

  /** For one message per patient: the channel each patient of the batch is sent on (the first that reaches them, else the first in order, so the record shows why nothing went). */
  private async planBatch(organizationId: string, batch: SegmentMember[], channels: OutreachChannel[]): Promise<Map<string, OutreachChannel>> {
    const plan = new Map<string, OutreachChannel>();
    const order = prioritized(channels);
    const results = await this.reachResults(organizationId, batch, channels);
    batch.forEach((member, i) => {
      plan.set(member.patientId, (results[i] ? firstAvailableChannel(channels, results[i]) : null) ?? order[0]!);
    });
    return plan;
  }

  // ---- limits on how often and when -------------------------------------------------------------------------------------

  async getSettings(actor: Actor): Promise<CrmSettingsView> {
    const [row] = await this.db.select().from(crmSetting).where(eq(crmSetting.organizationId, actor.organizationId));
    return settingsView(row);
  }

  /** Saves the organization's frequency cap and quiet hours (optimistic version; 0 before the first save). Audited. */
  async updateSettings(actor: Actor, input: CrmSettingsInput): Promise<CrmSettingsView> {
    const quiet = input.quietHours;
    if (quiet.enabled && (!quiet.start || !quiet.end || quiet.start === quiet.end || quiet.channels.length === 0)) {
      throw new BusinessRuleError("Quiet hours need a start, a different end and at least one channel", "quiet_hours_invalid");
    }
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(crmSetting).where(eq(crmSetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Outreach settings", current?.version ?? 0);
      const values = {
        capMaxCampaigns: input.frequencyCap?.maxCampaigns ?? null,
        capWindowDays: input.frequencyCap?.windowDays ?? null,
        quietHoursEnabled: quiet.enabled,
        quietStart: quiet.start,
        quietEnd: quiet.end,
        quietChannels: [...new Set(quiet.channels)],
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      const [row] = current
        ? await tx
            .update(crmSetting)
            .set({ ...values, version: current.version + 1 })
            .where(eq(crmSetting.organizationId, actor.organizationId))
            .returning()
        : await tx
            .insert(crmSetting)
            .values({ organizationId: actor.organizationId, ...values })
            .returning();
      await this.audit.record(tx, actor, {
        action: "crm.settings.update",
        resourceType: "crm_setting",
        resourceId: actor.organizationId,
        changes: {
          frequencyCap: { from: settingsView(current).frequencyCap, to: settingsView(row).frequencyCap },
          quietHours: { from: settingsView(current).quietHours, to: settingsView(row).quietHours },
        },
      });
      return settingsView(row);
    });
  }

  private async loadLimits(
    organizationId: string,
  ): Promise<{ cap: FrequencyCap | null; quiet: (QuietHours & { channels: Array<"sms" | "email" | "push"> }) | null }> {
    const [row] = await this.db.select().from(crmSetting).where(eq(crmSetting.organizationId, organizationId));
    const view = settingsView(row);
    return {
      cap: view.frequencyCap,
      quiet:
        view.quietHours.enabled && view.quietHours.start && view.quietHours.end
          ? { start: view.quietHours.start, end: view.quietHours.end, channels: view.quietHours.channels }
          : null,
    };
  }

  /** How many other outreach campaigns actually went to each patient in the window (queued or delivered, not held back). */
  private async recentCampaignCounts(
    organizationId: string,
    patientIds: string[],
    windowDays: number,
    excludeCampaignId: string,
    now: Date,
  ): Promise<Map<string, number>> {
    if (patientIds.length === 0) return new Map();
    const rows = await this.db
      .select({ patientId: crmCampaignDelivery.patientId, n: sql<number>`count(distinct ${crmCampaignDelivery.campaignId})::int` })
      .from(crmCampaignDelivery)
      .where(
        and(
          eq(crmCampaignDelivery.organizationId, organizationId),
          inArray(crmCampaignDelivery.patientId, patientIds),
          inArray(crmCampaignDelivery.outcome, ["queued", "delivered"]),
          gte(crmCampaignDelivery.createdAt, new Date(now.getTime() - windowDays * 86_400_000)),
          ne(crmCampaignDelivery.campaignId, excludeCampaignId),
        ),
      )
      .groupBy(crmCampaignDelivery.patientId);
    return new Map(rows.map((r) => [r.patientId, r.n]));
  }

  // ---- campaigns -----------------------------------------------------------------------------------------------------

  async listCampaigns(actor: Actor): Promise<CampaignView[]> {
    const rows = await this.db
      .select({ campaign: crmCampaign, segmentName: crmSegment.name })
      .from(crmCampaign)
      .innerJoin(crmSegment, eq(crmSegment.id, crmCampaign.segmentId))
      .where(eq(crmCampaign.organizationId, actor.organizationId))
      .orderBy(desc(crmCampaign.createdAt));
    return rows.map((r) => ({ ...r.campaign, segmentName: r.segmentName, summary: null }));
  }

  async getCampaign(actor: Actor, campaignId: string): Promise<CampaignView> {
    const [row] = await this.db
      .select({ campaign: crmCampaign, segmentName: crmSegment.name })
      .from(crmCampaign)
      .innerJoin(crmSegment, eq(crmSegment.id, crmCampaign.segmentId))
      .where(and(eq(crmCampaign.organizationId, actor.organizationId), eq(crmCampaign.id, campaignId)));
    if (!row) throw new NotFoundError("Campaign");
    const summary = ["sending", "completed"].includes(row.campaign.status) ? await this.summary(campaignId) : null;
    return { ...row.campaign, segmentName: row.segmentName, summary };
  }

  async createCampaign(actor: Actor, input: CampaignInput): Promise<CampaignView> {
    const wording = validateWording(input, this.portalBaseUrl, (await this.organizations.getOrganization(actor.organizationId)).name);
    return this.db.transaction(async (tx) => {
      const segment = await this.getSegment(actor.organizationId, input.segmentId, tx);
      if (segment.status !== "active") throw new BusinessRuleError("The segment is archived", "segment_archived");
      const [row] = await tx
        .insert(crmCampaign)
        .values({
          organizationId: actor.organizationId,
          segmentId: input.segmentId,
          name: input.name.trim(),
          channels: dedupe(input.channels),
          subject: wording.subject,
          body: wording.body,
          includeBookingLink: input.includeBookingLink ?? false,
          deliveryMode: input.deliveryMode ?? "all",
          sendAt: input.sendAt ? new Date(input.sendAt) : null,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "crm.campaign.create",
        resourceType: "crm_campaign",
        resourceId: row!.id,
        metadata: { segmentId: input.segmentId, channels: row!.channels },
      });
      return { ...row!, segmentName: segment.name, summary: null };
    });
  }

  /** Only drafts change (a submitted campaign goes back to draft first); the change makes the caller the author. */
  async updateCampaign(actor: Actor, campaignId: string, input: CampaignInput & { version: number }): Promise<CampaignView> {
    const wording = validateWording(input, this.portalBaseUrl, (await this.organizations.getOrganization(actor.organizationId)).name);
    return this.db.transaction(async (tx) => {
      const current = await this.lockCampaign(tx, actor.organizationId, campaignId);
      if (current.version !== input.version) throw new VersionConflictError("Campaign", current.version);
      if (current.status !== "draft") throw new BusinessRuleError("Only a draft campaign can be changed", "campaign_not_draft");
      const segment = await this.getSegment(actor.organizationId, input.segmentId, tx);
      if (segment.status !== "active") throw new BusinessRuleError("The segment is archived", "segment_archived");
      const [row] = await tx
        .update(crmCampaign)
        .set({
          segmentId: input.segmentId,
          name: input.name.trim(),
          channels: dedupe(input.channels),
          subject: wording.subject,
          body: wording.body,
          includeBookingLink: input.includeBookingLink ?? false,
          deliveryMode: input.deliveryMode ?? "all",
          sendAt: input.sendAt ? new Date(input.sendAt) : null,
          createdBy: actor.userId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(crmCampaign.id, campaignId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "crm.campaign.update",
        resourceType: "crm_campaign",
        resourceId: campaignId,
        changes: {
          body: { from: current.body, to: row!.body },
          subject: { from: current.subject, to: row!.subject },
          channels: { from: current.channels, to: row!.channels },
          includeBookingLink: { from: current.includeBookingLink, to: row!.includeBookingLink },
          deliveryMode: { from: current.deliveryMode, to: row!.deliveryMode },
          segmentId: { from: current.segmentId, to: row!.segmentId },
        },
      });
      return { ...row!, segmentName: segment.name, summary: null };
    });
  }

  async submitCampaign(actor: Actor, campaignId: string, version: number): Promise<CampaignView> {
    return this.transition(actor, campaignId, version, "submitted", (current) => ({
      submittedBy: actor.userId,
      submittedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
      ...(current.status === "draft" ? {} : {}),
    }));
  }

  /** Back to draft for changes; the approval, if any, is gone. */
  async reopenCampaign(actor: Actor, campaignId: string, version: number): Promise<CampaignView> {
    return this.transition(actor, campaignId, version, "draft", () => ({ submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null }));
  }

  async approveCampaign(actor: Actor, campaignId: string, version: number): Promise<CampaignView> {
    return this.transition(actor, campaignId, version, "approved", (current) => {
      if (!canApprove(current, actor.userId)) throw new ForbiddenError("A campaign is approved by someone other than its author", "approver_is_author");
      return { approvedBy: actor.userId, approvedAt: new Date() };
    });
  }

  async cancelCampaign(actor: Actor, campaignId: string, version: number, reason: string): Promise<CampaignView> {
    return this.transition(actor, campaignId, version, "cancelled", () => ({
      cancelledBy: actor.userId,
      cancelledAt: new Date(),
      cancelReason: reason.trim(),
    }));
  }

  private async transition(
    actor: Actor,
    campaignId: string,
    version: number,
    to: CampaignStatus,
    patch: (current: CrmCampaignRecord) => Partial<typeof crmCampaign.$inferInsert>,
  ): Promise<CampaignView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockCampaign(tx, actor.organizationId, campaignId);
      if (current.version !== version) throw new VersionConflictError("Campaign", current.version);
      if (!canTransition(current.status, to)) throw new BusinessRuleError(`A ${current.status} campaign cannot become ${to}`, "campaign_status");
      const [row] = await tx
        .update(crmCampaign)
        .set({ ...patch(current), status: to, version: current.version + 1, updatedAt: new Date() })
        .where(eq(crmCampaign.id, campaignId))
        .returning();
      await this.audit.record(tx, actor, {
        action: `crm.campaign.${to === "draft" ? "reopen" : to === "submitted" ? "submit" : to === "approved" ? "approve" : "cancel"}`,
        resourceType: "crm_campaign",
        resourceId: campaignId,
        changes: { status: { from: current.status, to } },
        ...(to === "cancelled" ? { reason: row!.cancelReason ?? undefined } : {}),
      });
      // The approvers are told when a campaign waits for them, and its author when it is approved (ids only).
      if (to === "submitted" || to === "approved") {
        await this.events.record(tx, {
          type: to === "submitted" ? "CrmCampaignSubmitted" : "CrmCampaignApproved",
          organizationId: actor.organizationId,
          aggregateType: "crm_campaign",
          aggregateId: campaignId,
          payload: { campaignId },
        });
      }
      const [segment] = await tx.select({ name: crmSegment.name }).from(crmSegment).where(eq(crmSegment.id, row!.segmentId));
      return { ...row!, segmentName: segment?.name ?? "", summary: null };
    });
  }

  // ---- approval nudges and the test send ---------------------------------------------------------------------------------

  /** Campaigns still waiting for approval past the reminder time that nobody was reminded about yet (all organizations: the hourly job). */
  async approvalRemindersDue(
    now = new Date(),
  ): Promise<Array<{ id: string; organizationId: string; name: string; createdBy: string; submittedBy: string | null }>> {
    const rows = await this.db.select().from(crmCampaign).where(eq(crmCampaign.status, "submitted"));
    return rows
      .filter((c) => approvalReminderDue(c, now))
      .map((c) => ({ id: c.id, organizationId: c.organizationId, name: c.name, createdBy: c.createdBy, submittedBy: c.submittedBy }));
  }

  /** The few fields a notice needs about a campaign (by id, any status); null when it is gone. */
  async campaignForNotice(
    organizationId: string,
    campaignId: string,
  ): Promise<{ id: string; organizationId: string; name: string; createdBy: string; submittedBy: string | null } | null> {
    const [row] = await this.db
      .select({
        id: crmCampaign.id,
        organizationId: crmCampaign.organizationId,
        name: crmCampaign.name,
        createdBy: crmCampaign.createdBy,
        submittedBy: crmCampaign.submittedBy,
      })
      .from(crmCampaign)
      .where(and(eq(crmCampaign.organizationId, organizationId), eq(crmCampaign.id, campaignId)));
    return row ?? null;
  }

  async markApprovalReminded(campaignId: string, now = new Date()): Promise<void> {
    await this.db
      .update(crmCampaign)
      .set({ approvalRemindedAt: now })
      .where(and(eq(crmCampaign.id, campaignId), isNull(crmCampaign.approvalRemindedAt)));
  }

  /**
   * A test of the campaign for the person who asked: the wording as one sample patient ("Maria") would get it, put in their
   * own notifications and emailed to them. Nothing goes to a patient, no delivery is recorded and nothing is counted against
   * a cap. Text messages and push cannot be tried (staff have no phone number or app on file here): check their length in the
   * form. Only a campaign that has not gone out.
   */
  async testSend(actor: Actor, campaignId: string): Promise<{ sent: Array<{ channel: "in_app" | "email"; status: string; reason: string | null }> }> {
    const campaign = await this.getCampaign(actor, campaignId);
    if (!["draft", "submitted", "approved"].includes(campaign.status))
      throw new BusinessRuleError("Only a campaign that has not gone out can be tested", "campaign_sent");
    const organization = await this.organizations.getOrganization(actor.organizationId);
    const values = { firstName: "Maria", clinicName: organization.name };
    const note = "\n\n— This is a test, sent only to you.";
    const subject = `[Test] ${campaign.subject ? renderWording(campaign.subject, values) : `A message from ${organization.name}`}`.slice(0, 120);
    const body = `${renderWording(campaign.body, values)}${note}`.slice(0, 2000);
    const bookingLink = campaign.includeBookingLink && this.portalBaseUrl ? bookingLinkUrl(this.portalBaseUrl) : undefined;
    const sent: Array<{ channel: "in_app" | "email"; status: string; reason: string | null }> = [];
    for (const channel of ["in_app", "email"] as const) {
      const view = await this.notifications.send(actor, {
        recipient: { type: "user", userId: actor.userId },
        channel,
        templateKey: "outreach.campaign",
        variables: { organizationName: organization.name, subject, body, bookingLink },
        idempotencyKey: `crm-test:${campaignId}:${actor.userId}:${channel}:${Date.now()}`,
      });
      sent.push({ channel, status: view.status, reason: view.suppressionReason });
    }
    await this.audit.recordStandalone(actor, {
      action: "crm.campaign.test-send",
      resourceType: "crm_campaign",
      resourceId: campaignId,
      metadata: { channels: sent.map((s) => s.channel) },
    });
    return { sent };
  }

  // ---- sending (the runner) ------------------------------------------------------------------------------------------

  /** Sends every approved campaign whose time has come. One campaign at a time; idempotent per patient and channel. */
  async sendDue(now = new Date()): Promise<{ campaigns: number; deliveries: number }> {
    const due = await this.db
      .select()
      .from(crmCampaign)
      .where(or(and(eq(crmCampaign.status, "approved"), or(isNull(crmCampaign.sendAt), lte(crmCampaign.sendAt, now))), eq(crmCampaign.status, "sending")))
      .orderBy(crmCampaign.sendAt, crmCampaign.createdAt);
    let deliveries = 0;
    let campaigns = 0;
    for (const campaign of due) {
      if (campaign.status === "approved" && !isDueToSend(campaign, now)) continue;
      deliveries += await this.sendCampaign(campaign, now);
      campaigns += 1;
    }
    return { campaigns, deliveries };
  }

  private async sendCampaign(campaign: CrmCampaignRecord, now: Date): Promise<number> {
    const organization = await this.organizations.getOrganization(campaign.organizationId);
    if (campaign.status === "approved") {
      await this.db
        .update(crmCampaign)
        .set({ status: "sending", startedAt: now, version: sql`${crmCampaign.version} + 1`, updatedAt: now })
        .where(eq(crmCampaign.id, campaign.id));
    }
    const [segment] = await this.db.select().from(crmSegment).where(eq(crmSegment.id, campaign.segmentId));
    const members = segment ? await this.source.evaluate(campaign.organizationId, segment.criteria, todayInPhilippines(now)) : [];
    const done = new Set(
      (
        await this.db
          .select({ patientId: crmCampaignDelivery.patientId, channel: crmCampaignDelivery.channel })
          .from(crmCampaignDelivery)
          .where(eq(crmCampaignDelivery.campaignId, campaign.id))
      ).map((d) => `${d.patientId}/${d.channel}`),
    );
    const actor = systemActor(campaign.organizationId, null, "outreach-campaign");
    // The organization's limits are read once per run: a patient the frequency cap holds back is recorded, not messaged,
    // and text messages and push notices that fall in quiet hours are queued for when the period ends.
    const { cap, quiet } = await this.loadLimits(campaign.organizationId);
    const holdUntil = (channel: OutreachChannel): Date | null =>
      quiet && quiet.channels.includes(channel as "sms" | "email" | "push") ? quietHoldUntil(now, quiet) : null;
    const onePerPatient = campaign.deliveryMode === "first_available";
    const donePatients = new Set([...done].map((key) => key.split("/")[0]));
    let sent = 0;
    for (let i = 0; i < members.length; i += SEND_BATCH) {
      const batch = members.slice(i, i + SEND_BATCH);
      const recent = cap
        ? await this.recentCampaignCounts(
            campaign.organizationId,
            batch.map((m) => m.patientId),
            cap.windowDays,
            campaign.id,
            now,
          )
        : new Map<string, number>();
      // One message per patient: each patient not yet handled gets one channel, chosen from who can be reached now.
      const plan = onePerPatient
        ? await this.planBatch(
            campaign.organizationId,
            batch.filter((m) => !donePatients.has(m.patientId)),
            campaign.channels,
          )
        : null;
      for (const member of batch) {
        const held = capReached(recent.get(member.patientId) ?? 0, cap);
        const planned = plan?.get(member.patientId);
        const targets: OutreachChannel[] = plan ? (planned ? [planned] : []) : campaign.channels;
        for (const channel of targets) {
          if (!plan && done.has(`${member.patientId}/${channel}`)) continue;
          if (held) await this.recordHeldBack(campaign, member.patientId, channel);
          else await this.deliver(actor, campaign, organization.name, member, channel, now, holdUntil(channel));
          sent += 1;
        }
      }
    }
    await this.db
      .update(crmCampaign)
      .set({ status: "completed", completedAt: new Date(), version: sql`${crmCampaign.version} + 1`, updatedAt: new Date() })
      .where(eq(crmCampaign.id, campaign.id));
    const summary = await this.summary(campaign.id);
    await this.audit.recordStandalone(actor, {
      action: "crm.campaign.run",
      resourceType: "crm_campaign",
      resourceId: campaign.id,
      metadata: { patients: summary.patients, byChannel: summary.byChannel, suppressedByReason: summary.suppressedByReason },
    });
    return sent;
  }

  private async deliver(
    actor: Actor,
    campaign: CrmCampaignRecord,
    organizationName: string,
    member: SegmentMember,
    channel: OutreachChannel,
    now: Date,
    holdUntil: Date | null = null,
  ): Promise<void> {
    const patientId = member.patientId;
    // The wording is the one that was approved, with the placeholders filled in for this patient (first name, clinic name).
    const values = { firstName: firstNameOf(member.givenName), clinicName: organizationName };
    let outcome: DeliveryOutcome = "failed";
    let reason: string | null = null;
    let notificationId: string | null = null;
    try {
      const optOutLink = channel === "email" ? await this.optOutLink(campaign, patientId, channel, now) : undefined;
      const bookingLink = campaign.includeBookingLink && this.portalBaseUrl ? bookingLinkUrl(this.portalBaseUrl) : undefined;
      const view = await this.notifications.send(actor, {
        recipient: { type: "patient", patientId },
        channel,
        templateKey: "outreach.campaign",
        variables: {
          organizationName,
          subject: campaign.subject ? renderWording(campaign.subject, values) : undefined,
          body: renderWording(campaign.body, values),
          optOutLink,
          bookingLink,
        },
        idempotencyKey: `crm:${campaign.id}:${patientId}:${channel}`,
        ...(holdUntil ? { scheduledFor: holdUntil.toISOString() } : {}),
      });
      notificationId = view.id;
      outcome = view.status === "suppressed" ? "suppressed" : view.status === "failed" ? "failed" : view.status === "delivered" ? "delivered" : "queued";
      reason = view.suppressionReason ?? (holdUntil && outcome === "queued" ? REASON_QUIET_HOURS : null);
    } catch (error) {
      reason = String(error).slice(0, 200);
      this.logger.warn({ event: "crm.delivery_failed", campaignId: campaign.id, channel, message: reason });
    }
    await this.db
      .insert(crmCampaignDelivery)
      .values({ campaignId: campaign.id, organizationId: campaign.organizationId, patientId, channel, notificationId, outcome, reason })
      .onConflictDoNothing();
  }

  /** The patient is within the organization's frequency cap already: nothing is sent, and the record says why. */
  private async recordHeldBack(campaign: CrmCampaignRecord, patientId: string, channel: OutreachChannel): Promise<void> {
    await this.db
      .insert(crmCampaignDelivery)
      .values({
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        patientId,
        channel,
        notificationId: null,
        outcome: "suppressed",
        reason: REASON_FREQUENCY_CAP,
      })
      .onConflictDoNothing();
  }

  /** A single-use link for this patient and channel, when MyHealth's address (PORTAL_BASE_URL) is known; nothing otherwise. */
  private async optOutLink(campaign: CrmCampaignRecord, patientId: string, channel: OutreachChannel, now: Date): Promise<string | undefined> {
    if (!this.portalBaseUrl) return undefined;
    const token = randomToken(32);
    await this.db.insert(crmOptOutToken).values({
      organizationId: campaign.organizationId,
      patientId,
      campaignId: campaign.id,
      channel,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + OPT_OUT_TOKEN_DAYS * 86_400_000),
    });
    return `${this.portalBaseUrl}/outreach/opt-out?token=${token}`;
  }

  private get portalBaseUrl(): string | undefined {
    return this.portalBase?.replace(/\/$/, "");
  }

  /** Records the opt-out the link stands for. The answer never says whether the token existed. */
  async optOutByToken(token: string): Promise<{ channel: OutreachChannel } | null> {
    const [row] = await this.db
      .select()
      .from(crmOptOutToken)
      .where(eq(crmOptOutToken.tokenHash, sha256Hex(token)));
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
    await this.preferences.optOut(row.organizationId, row.patientId, row.channel, row.campaignId);
    await this.db.update(crmOptOutToken).set({ usedAt: new Date() }).where(eq(crmOptOutToken.id, row.id));
    return { channel: row.channel };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private async summary(campaignId: string): Promise<CampaignSummary> {
    const rows = await this.db
      .select({
        channel: crmCampaignDelivery.channel,
        outcome: crmCampaignDelivery.outcome,
        reason: crmCampaignDelivery.reason,
        total: sql<number>`count(*)::int`,
      })
      .from(crmCampaignDelivery)
      .where(eq(crmCampaignDelivery.campaignId, campaignId))
      .groupBy(crmCampaignDelivery.channel, crmCampaignDelivery.outcome, crmCampaignDelivery.reason);
    const [{ patients }] = await this.db
      .select({ patients: sql<number>`count(distinct ${crmCampaignDelivery.patientId})::int` })
      .from(crmCampaignDelivery)
      .where(eq(crmCampaignDelivery.campaignId, campaignId));
    const byChannel = new Map<OutreachChannel, { channel: OutreachChannel; queued: number; delivered: number; suppressed: number; failed: number }>();
    const byReason = new Map<string, number>();
    for (const row of rows) {
      const entry = byChannel.get(row.channel) ?? { channel: row.channel, queued: 0, delivered: 0, suppressed: 0, failed: 0 };
      entry[row.outcome] += row.total;
      byChannel.set(row.channel, entry);
      if (row.outcome === "suppressed") byReason.set(row.reason ?? "unknown", (byReason.get(row.reason ?? "unknown") ?? 0) + row.total);
    }
    return {
      patients: patients ?? 0,
      heldForQuietHours: rows.filter((r) => r.outcome === "queued" && r.reason === REASON_QUIET_HOURS).reduce((sum, r) => sum + r.total, 0),
      byChannel: [...byChannel.values()],
      suppressedByReason: [...byReason.entries()].map(([reason, total]) => ({ reason, total })).sort((a, b) => b.total - a.total),
    };
  }

  private async getSegment(organizationId: string, segmentId: string, db: Pick<Database, "select"> = this.db): Promise<CrmSegmentRecord> {
    const [row] = await db
      .select()
      .from(crmSegment)
      .where(and(eq(crmSegment.organizationId, organizationId), eq(crmSegment.id, segmentId)));
    if (!row) throw new NotFoundError("Segment");
    return row;
  }

  private async lockSegment(tx: Database, organizationId: string, segmentId: string): Promise<CrmSegmentRecord> {
    const [row] = await tx
      .select()
      .from(crmSegment)
      .where(and(eq(crmSegment.organizationId, organizationId), eq(crmSegment.id, segmentId)))
      .for("update");
    if (!row) throw new NotFoundError("Segment");
    return row;
  }

  private async lockCampaign(tx: Database, organizationId: string, campaignId: string): Promise<CrmCampaignRecord> {
    const [row] = await tx
      .select()
      .from(crmCampaign)
      .where(and(eq(crmCampaign.organizationId, organizationId), eq(crmCampaign.id, campaignId)))
      .for("update");
    if (!row) throw new NotFoundError("Campaign");
    return row;
  }
}

function parseCriteria(input: unknown): SegmentCriteria {
  const parsed = segmentCriteriaSchema.safeParse(input);
  if (!parsed.success)
    throw new BusinessRuleError(
      "Segment criteria are invalid",
      "invalid_criteria",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  return parsed.data;
}

function validateWording(input: CampaignInput, portalBase: string | undefined, clinicName: string): { subject: string | null; body: string } {
  const subject = input.subject?.trim() || null;
  const body = input.body.trim();
  if (input.includeBookingLink && !portalBase) {
    throw new BusinessRuleError("MyHealth's address is not set up, so a booking link cannot be added", "portal_base_missing");
  }
  const reservedChars = input.includeBookingLink && portalBase ? bookingLinkText(portalBase).length : 0;
  const problems = wordingProblems({ channels: input.channels, subject, body, reservedChars, clinicName });
  if (problems.length > 0) throw new BusinessRuleError("The wording does not fit the chosen channels", "wording_invalid", problems);
  if (input.sendAt && Number.isNaN(Date.parse(input.sendAt))) throw new BusinessRuleError("sendAt is not a date", "invalid_send_at");
  return { subject, body };
}

function settingsView(row: typeof crmSetting.$inferSelect | undefined): CrmSettingsView {
  if (!row) return { frequencyCap: null, quietHours: { enabled: false, start: null, end: null, channels: ["sms", "push"] }, version: 0, updatedAt: null };
  return {
    frequencyCap: row.capMaxCampaigns && row.capWindowDays ? { maxCampaigns: row.capMaxCampaigns, windowDays: row.capWindowDays } : null,
    quietHours: { enabled: row.quietHoursEnabled, start: row.quietStart, end: row.quietEnd, channels: row.quietChannels },
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function dedupe(channels: OutreachChannel[]): OutreachChannel[] {
  return [...new Set(channels)];
}
