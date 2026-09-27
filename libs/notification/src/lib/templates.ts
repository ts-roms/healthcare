import { z } from "zod";
import type { NotificationCategory, NotificationChannel } from "./notification.schema";

/**
 * Message templates are code-reviewed, versioned and variable-validated.
 * Rules (CLAUDE.md §16): SMS, email and push leave the platform, so they must
 * never carry diagnoses, results or other clinical detail. Point the patient
 * to the portal instead.
 */
export interface NotificationTemplate<V extends z.ZodType = z.ZodType> {
  key: string;
  version: number;
  category: NotificationCategory;
  channels: readonly NotificationChannel[];
  variables: V;
  render(variables: z.infer<V>): RenderedMessage;
}

export interface RenderedMessage {
  subject?: string;
  text: string;
}

function defineTemplate<V extends z.ZodType>(template: NotificationTemplate<V>): NotificationTemplate<V> {
  return template;
}

const shortText = z.string().trim().min(1).max(80);

export const TEMPLATES = [
  defineTemplate({
    key: "patient.registered",
    version: 1,
    category: "administrative",
    channels: ["sms", "email"],
    variables: z.object({ givenName: shortText, organizationName: shortText, patientNumber: z.string().regex(/^P\d{8}$/) }),
    render: (v) => ({
      subject: `Welcome to ${v.organizationName}`,
      text: `Hi ${v.givenName}, you are now registered at ${v.organizationName}. Your patient number is ${v.patientNumber}.`,
    }),
  }),
  defineTemplate({
    key: "appointment.reminder",
    version: 1,
    category: "administrative",
    channels: ["sms", "email"],
    // No patient name, practitioner specialty or reason: only where and when.
    variables: z.object({ facilityName: shortText, date: z.string().max(40), time: z.string().max(20) }),
    render: (v) => ({
      subject: `Appointment reminder: ${v.date}`,
      text: `Reminder: you have an appointment at ${v.facilityName} on ${v.date} at ${v.time}. Please arrive 15 minutes early. To reschedule, contact the clinic.`,
    }),
  }),
  defineTemplate({
    key: "security.mfa-enabled",
    version: 1,
    category: "security",
    channels: ["email", "in_app"],
    variables: z.object({ displayName: shortText }),
    render: (v) => ({
      subject: "Two-step verification was turned on",
      text: `Hi ${v.displayName}, two-step verification was turned on for your account. If this was not you, contact your administrator immediately.`,
    }),
  }),
  defineTemplate({
    key: "staff.message",
    version: 1,
    category: "administrative",
    // In-app only: free text written by staff stays inside the platform.
    channels: ["in_app"],
    variables: z.object({ title: shortText, body: z.string().trim().min(1).max(2000) }),
    render: (v) => ({ subject: v.title, text: v.body }),
  }),
  defineTemplate({
    key: "lab.results-available",
    version: 1,
    category: "clinical",
    // Leaves the platform (SMS/email): no test names, values or flags — only a pointer to MyHealth.
    channels: ["sms", "email"],
    variables: z.object({ kind: z.enum(["ready", "updated"]), organizationName: shortText }),
    render: (v) =>
      v.kind === "ready"
        ? {
            subject: `New results from ${v.organizationName}`,
            text: `${v.organizationName}: you have new laboratory results in MyHealth. Sign in to view them. For questions about your results, talk to your doctor.`,
          }
        : {
            subject: `An updated result from ${v.organizationName}`,
            text: `${v.organizationName}: one of your laboratory results in MyHealth was updated. Sign in to see the latest version, and talk to your doctor if you have questions.`,
          },
  }),
  defineTemplate({
    key: "lab.result-notice",
    version: 1,
    category: "clinical",
    // In-app to the ordering practitioner. Identifiers only: the value is read in the order, behind access control.
    channels: ["in_app"],
    variables: z.object({
      kind: z.enum(["critical", "corrected"]),
      orderNumber: z.string().regex(/^LO\d{8}$/),
      patientNumber: z.string().regex(/^P\d{8}$/),
    }),
    render: (v) =>
      v.kind === "critical"
        ? {
            subject: `Critical laboratory result — ${v.patientNumber}`,
            text: `A critical result was verified on laboratory order ${v.orderNumber} for patient ${v.patientNumber}. Open the order to review and acknowledge it.`,
          }
        : {
            subject: `Corrected laboratory result — ${v.patientNumber}`,
            text: `A released result on laboratory order ${v.orderNumber} for patient ${v.patientNumber} was corrected. Open the order to see the new version and its reason.`,
          },
  }),
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [TemplateKey, ...TemplateKey[]];

export function findTemplate(key: string): NotificationTemplate | undefined {
  return (TEMPLATES as readonly NotificationTemplate[]).find((t) => t.key === key);
}
