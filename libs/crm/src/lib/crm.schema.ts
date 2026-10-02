import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SegmentCriteria } from "./crm.rules";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const OUTREACH_CHANNELS = ["sms", "email", "push", "in_app"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
export const SEGMENT_STATUSES = ["active", "archived"] as const;
export const CAMPAIGN_STATUSES = ["draft", "submitted", "approved", "sending", "completed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const DELIVERY_OUTCOMES = ["queued", "delivered", "suppressed", "failed"] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export const crmSegment = pgTable("crm_segment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  criteria: jsonb("criteria").$type<SegmentCriteria>().notNull(),
  status: text("status").$type<(typeof SEGMENT_STATUSES)[number]>().notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const crmCampaign = pgTable(
  "crm_campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    segmentId: uuid("segment_id").notNull(),
    name: text("name").notNull(),
    channels: text("channels").array().$type<OutreachChannel[]>().notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    sendAt: ts("send_at"),
    createdBy: uuid("created_by").notNull(),
    submittedBy: uuid("submitted_by"),
    submittedAt: ts("submitted_at"),
    approvedBy: uuid("approved_by"),
    approvedAt: ts("approved_at"),
    cancelledBy: uuid("cancelled_by"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("crm_campaign_due_idx").on(t.status, t.sendAt)],
);

export const crmCampaignDelivery = pgTable(
  "crm_campaign_delivery",
  {
    campaignId: uuid("campaign_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    notificationId: uuid("notification_id"),
    outcome: text("outcome").$type<DeliveryOutcome>().notNull(),
    reason: text("reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.patientId, t.channel] }), index("crm_campaign_delivery_patient_idx").on(t.organizationId, t.patientId)],
);

export const crmOptOutToken = pgTable("crm_opt_out_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  channel: text("channel").$type<OutreachChannel>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type CrmSegmentRecord = typeof crmSegment.$inferSelect;
export type CrmCampaignRecord = typeof crmCampaign.$inferSelect;
export type CrmCampaignDeliveryRecord = typeof crmCampaignDelivery.$inferSelect;
