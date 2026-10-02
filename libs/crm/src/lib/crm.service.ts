import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
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
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { canApprove, canTransition, isDueToSend, OPT_OUT_TOKEN_DAYS, type SegmentCriteria, segmentCriteriaSchema, wordingProblems } from "./crm.rules";
import {
  type CampaignStatus,
  crmCampaign,
  crmCampaignDelivery,
  type CrmCampaignRecord,
  crmOptOutToken,
  crmSegment,
  type CrmSegmentRecord,
  type DeliveryOutcome,
  type OutreachChannel,
} from "./crm.schema";
import { CRM_PREFERENCES, CRM_SEGMENT_SOURCE, type CrmPreferenceWriter, type CrmSegmentSource, type SegmentMember } from "./ports";

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
}

export interface CampaignSummary {
  patients: number;
  byChannel: Array<{ channel: OutreachChannel; queued: number; delivered: number; suppressed: number; failed: number }>;
  suppressedByReason: Array<{ reason: string; total: number }>;
}

export type SegmentView = CrmSegmentRecord;
export type CampaignView = CrmCampaignRecord & { segmentName: string; summary: CampaignSummary | null };

const PREVIEW_LIMIT = 200;
const SEND_BATCH = 100;

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
  ) {}

  // ---- segments ------------------------------------------------------------------------------------------------------

  async listSegments(actor: Actor): Promise<SegmentView[]> {
    return this.db.select().from(crmSegment).where(eq(crmSegment.organizationId, actor.organizationId)).orderBy(crmSegment.status, crmSegment.name);
  }

  async createSegment(actor: Actor, input: SegmentInput): Promise<SegmentView> {
    const criteria = parseCriteria(input.criteria);
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
  async previewSegment(actor: Actor, segmentId: string): Promise<{ total: number; members: SegmentMember[]; truncated: boolean }> {
    const segment = await this.getSegment(actor.organizationId, segmentId);
    const members = await this.source.evaluate(actor.organizationId, segment.criteria, todayInPhilippines());
    await this.audit.recordStandalone(actor, {
      action: "crm.segment.preview",
      resourceType: "crm_segment",
      resourceId: segmentId,
      metadata: { total: members.length, listed: Math.min(members.length, PREVIEW_LIMIT) },
    });
    return { total: members.length, members: members.slice(0, PREVIEW_LIMIT), truncated: members.length > PREVIEW_LIMIT };
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
    const wording = validateWording(input);
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
    const wording = validateWording(input);
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
      const [segment] = await tx.select({ name: crmSegment.name }).from(crmSegment).where(eq(crmSegment.id, row!.segmentId));
      return { ...row!, segmentName: segment?.name ?? "", summary: null };
    });
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
    let sent = 0;
    for (let i = 0; i < members.length; i += SEND_BATCH) {
      for (const member of members.slice(i, i + SEND_BATCH)) {
        for (const channel of campaign.channels) {
          if (done.has(`${member.patientId}/${channel}`)) continue;
          await this.deliver(actor, campaign, organization.name, member.patientId, channel, now);
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
    patientId: string,
    channel: OutreachChannel,
    now: Date,
  ): Promise<void> {
    let outcome: DeliveryOutcome = "failed";
    let reason: string | null = null;
    let notificationId: string | null = null;
    try {
      const optOutLink = channel === "email" ? await this.optOutLink(campaign, patientId, channel, now) : undefined;
      const view = await this.notifications.send(actor, {
        recipient: { type: "patient", patientId },
        channel,
        templateKey: "outreach.campaign",
        variables: { organizationName, subject: campaign.subject ?? undefined, body: campaign.body, optOutLink },
        idempotencyKey: `crm:${campaign.id}:${patientId}:${channel}`,
      });
      notificationId = view.id;
      outcome = view.status === "suppressed" ? "suppressed" : view.status === "failed" ? "failed" : view.status === "delivered" ? "delivered" : "queued";
      reason = view.suppressionReason;
    } catch (error) {
      reason = String(error).slice(0, 200);
      this.logger.warn({ event: "crm.delivery_failed", campaignId: campaign.id, channel, message: reason });
    }
    await this.db
      .insert(crmCampaignDelivery)
      .values({ campaignId: campaign.id, organizationId: campaign.organizationId, patientId, channel, notificationId, outcome, reason })
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

function validateWording(input: CampaignInput): { subject: string | null; body: string } {
  const subject = input.subject?.trim() || null;
  const body = input.body.trim();
  const problems = wordingProblems({ channels: input.channels, subject, body });
  if (problems.length > 0) throw new BusinessRuleError("The wording does not fit the chosen channels", "wording_invalid", problems);
  if (input.sendAt && Number.isNaN(Date.parse(input.sendAt))) throw new BusinessRuleError("sendAt is not a date", "invalid_send_at");
  return { subject, body };
}

function dedupe(channels: OutreachChannel[]): OutreachChannel[] {
  return [...new Set(channels)];
}
