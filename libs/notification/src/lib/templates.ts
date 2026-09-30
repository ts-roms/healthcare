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
  /**
   * Sent only by the platform itself, never through the public send endpoint (the caller would choose the wording and
   * links of a security message).
   */
  internal?: boolean;
  /** Variables that are credentials (e.g. a reset token): blanked in the stored notification once it is sent, suppressed or failed. */
  secretVariables?: readonly string[];
  render(variables: z.infer<V>): RenderedMessage;
}

export interface RenderedMessage {
  subject?: string;
  text: string;
  /** Staff in-app only: the page in the staff app the message is about. */
  href?: string;
}

function defineTemplate<V extends z.ZodType>(template: NotificationTemplate<V>): NotificationTemplate<V> {
  return template;
}

const shortText = z.string().trim().min(1).max(80);

/** Labels of the laboratory's nonconformance categories (libs/laboratory quality-management.schema.ts). */
const NONCONFORMANCE_CATEGORY_LABEL = {
  pre_analytical: "Pre-analytical",
  analytical: "Analytical",
  post_analytical: "Post-analytical",
  equipment: "Equipment",
  temperature_excursion: "Temperature excursion",
  qc_failure: "QC failure",
  eqa_failure: "EQA failure",
  safety: "Safety",
  complaint: "Complaint",
  other: "Other",
} as const;

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
    version: 2,
    category: "administrative",
    channels: ["sms", "email"],
    // No patient name, practitioner specialty or reason: only where and when.
    variables: z.object({ facilityName: shortText, date: z.string().max(40), time: z.string().max(20) }),
    render: (v) => ({
      subject: `Appointment reminder: ${v.date}`,
      text: `Reminder: you have an appointment at ${v.facilityName} on ${v.date} at ${v.time}. Please arrive 15 minutes early. To reschedule, use MyHealth or contact the clinic.`,
    }),
  }),
  defineTemplate({
    key: "appointment.self-service",
    version: 1,
    category: "administrative",
    // In-app too: PatientBookingNotices puts a copy in the MyHealth inbox (docs/architecture/portal-app.md).
    channels: ["sms", "email", "in_app"],
    // Confirms what the patient did in MyHealth. Like the reminder: where and when only, no reason or practitioner specialty.
    variables: z.object({
      kind: z.enum(["booked", "rescheduled", "cancelled"]),
      facilityName: shortText,
      date: z.string().max(40),
      time: z.string().max(20),
    }),
    render: (v) =>
      v.kind === "cancelled"
        ? {
            subject: `Appointment cancelled: ${v.date}`,
            text: `Your appointment at ${v.facilityName} on ${v.date} at ${v.time} was cancelled in MyHealth. If you did not do this, contact the clinic.`,
          }
        : {
            subject: `Appointment ${v.kind}: ${v.date}`,
            text: `Your appointment at ${v.facilityName} is ${v.kind === "booked" ? "booked" : "moved"} for ${v.date} at ${v.time}. You can view or change it in MyHealth until 2 hours before.`,
          },
  }),
  defineTemplate({
    key: "appointment.no-show",
    version: 1,
    category: "administrative",
    channels: ["sms", "email", "in_app"],
    // A friendly follow-up after a missed visit: where and when only, never why the patient was booked.
    variables: z.object({ facilityName: shortText, date: z.string().max(40) }),
    render: (v) => ({
      subject: `We missed you on ${v.date}`,
      text: `We missed you at ${v.facilityName} on ${v.date}. If you still need care, book a new visit in MyHealth or call the clinic.`,
    }),
  }),
  defineTemplate({
    key: "care-plan.follow-up-due",
    version: 1,
    // Part of the care the patient's own clinician planned (not marketing), so a care message the patient can opt out of.
    category: "clinical",
    channels: ["sms", "email", "in_app"],
    // No plan name, condition, test or activity text: only that something planned is due and whom to contact.
    variables: z.object({ kind: z.enum(["due", "overdue"]), organizationName: shortText, date: z.string().max(40) }),
    render: (v) =>
      v.kind === "due"
        ? {
            subject: `A follow-up is due from ${v.date}`,
            text: `${v.organizationName}: your care plan has a follow-up due from ${v.date}. Book it in MyHealth or call the clinic.`,
          }
        : {
            subject: "A follow-up is overdue",
            text: `${v.organizationName}: a follow-up in your care plan was due on ${v.date} and has not been booked yet. Book it in MyHealth or call the clinic.`,
          },
  }),
  defineTemplate({
    key: "clinic.message",
    version: 1,
    category: "administrative",
    // In-app only: free text written by the clinic stays inside MyHealth, behind sign-in.
    channels: ["in_app"],
    variables: z.object({ title: shortText, body: z.string().trim().min(1).max(2000) }),
    render: (v) => ({ subject: v.title, text: v.body }),
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
    key: "portal.password-reset",
    version: 1,
    category: "security",
    channels: ["email"],
    internal: true,
    secretVariables: ["link"],
    variables: z.object({ organizationName: shortText, link: z.url().max(500), validMinutes: z.number().int().min(1).max(240) }),
    render: (v) => ({
      subject: `Reset your ${v.organizationName} MyHealth password`,
      text:
        `Someone asked to reset the password of your MyHealth account at ${v.organizationName}. ` +
        `To choose a new password, open this link within ${v.validMinutes} minutes and enter your date of birth:\n\n${v.link}\n\n` +
        `The link works once. If you did not ask for this, you can ignore this message: your password stays the same.`,
    }),
  }),
  defineTemplate({
    key: "portal.password-changed",
    version: 1,
    category: "security",
    channels: ["email"],
    internal: true,
    variables: z.object({ organizationName: shortText }),
    render: (v) => ({
      subject: `Your ${v.organizationName} MyHealth password was changed`,
      text: `The password of your MyHealth account at ${v.organizationName} was just changed, and you were signed out everywhere. If this was not you, contact the clinic right away.`,
    }),
  }),
  defineTemplate({
    key: "portal.email-verification",
    version: 1,
    category: "security",
    channels: ["email"],
    internal: true,
    secretVariables: ["code"],
    variables: z.object({ organizationName: shortText, code: z.string().regex(/^\d{6}$/), validMinutes: z.number().int().min(1).max(240) }),
    render: (v) => ({
      subject: `Your ${v.organizationName} MyHealth verification code: ${v.code}`,
      text:
        `Your MyHealth verification code is ${v.code}. Enter it in MyHealth within ${v.validMinutes} minutes to confirm this email address for your account at ${v.organizationName}.\n\n` +
        `If you did not ask for this, you can ignore this message.`,
    }),
  }),
  defineTemplate({
    key: "portal.security-alert",
    version: 1,
    category: "security",
    channels: ["email"],
    internal: true,
    variables: z.object({
      organizationName: shortText,
      event: z.enum([
        "mfa_enabled",
        "mfa_disabled",
        "mfa_reset_by_clinic",
        "recovery_code_used",
        "recovery_codes_renewed",
        "email_changed",
        "proxy_access_granted",
        "proxy_access_ended",
      ]),
      /** For "recovery_code_used": how many are left; for "email_changed": the new address, partly hidden. */
      detail: shortText.optional(),
    }),
    render: (v) => {
      const what = {
        mfa_enabled: "Two-step verification was turned on for your MyHealth account.",
        mfa_disabled: "Two-step verification was turned off for your MyHealth account.",
        mfa_reset_by_clinic:
          "The clinic turned off two-step verification for your MyHealth account, and you were signed out everywhere. Set it up again when you sign in.",
        recovery_code_used: `A recovery code was used to sign in to your MyHealth account${v.detail ? ` (${v.detail} left)` : ""}.`,
        recovery_codes_renewed: "New recovery codes were made for your MyHealth account. The old ones no longer work.",
        proxy_access_granted:
          "The clinic allowed another person, who has their own MyHealth account, to see and act on your records in MyHealth. You can end this in MyHealth under People.",
        proxy_access_ended: "Another person's access to your records in MyHealth was ended.",
        email_changed: `The sign-in email of your MyHealth account was changed${v.detail ? ` to ${v.detail}` : ""}.`,
      }[v.event];
      return {
        subject: `Security notice for your ${v.organizationName} MyHealth account`,
        text: `${what} If this was not you, contact the clinic right away.`,
      };
    },
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
    channels: ["sms", "email", "push", "in_app"],
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
    key: "dental.record-update",
    version: 1,
    category: "clinical",
    // Leaves the platform (SMS/email): no tooth, procedure, image type or finding — only a pointer to MyHealth.
    channels: ["sms", "email", "push", "in_app"],
    variables: z.object({ kind: z.enum(["image-shared", "plan-to-review", "plan-to-decide"]), organizationName: shortText }),
    render: (v) => {
      switch (v.kind) {
        case "image-shared":
          return {
            subject: `Your dentist shared an image with you`,
            text: `${v.organizationName}: your dentist shared an X-ray or photo with you in MyHealth. Sign in to see it, and ask your dentist to explain it.`,
          };
        case "plan-to-review":
          return {
            subject: `A dental treatment plan from ${v.organizationName}`,
            text: `${v.organizationName}: your dentist prepared a dental treatment plan for you. Sign in to MyHealth to read it, then tell your dentist or the clinic what you decide.`,
          };
        case "plan-to-decide":
          return {
            subject: `A dental treatment plan is waiting for your decision`,
            text: `${v.organizationName}: a dental treatment plan is waiting for your decision in MyHealth. Sign in to review it; you can also talk to your dentist first.`,
          };
      }
    },
  }),
  defineTemplate({
    key: "records.update",
    version: 1,
    category: "administrative",
    // Leaves the platform (SMS/email): no diagnosis, purpose or document title — only a pointer to MyHealth.
    channels: ["sms", "email", "push", "in_app"],
    variables: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("certificate-ready"), organizationName: shortText }),
      z.object({ kind: z.literal("request-answered"), organizationName: shortText, requestNumber: z.string().regex(/^RR\d{8}$/) }),
      // No recipient, specialty or reason: those are in the letter, behind sign-in.
      z.object({ kind: z.literal("referral-ready"), organizationName: shortText }),
    ]),
    render: (v) => {
      switch (v.kind) {
        case "certificate-ready":
          return {
            subject: "Your medical certificate is ready",
            text: `${v.organizationName}: a medical certificate from your visit is ready in MyHealth. Sign in to download it.`,
          };
        case "request-answered":
          return {
            subject: `Your records request ${v.requestNumber} was answered`,
            text: `${v.organizationName}: the records office answered your request ${v.requestNumber}. Sign in to MyHealth to see the answer.`,
          };
        case "referral-ready":
          return {
            subject: "Your referral letter is ready",
            text: `${v.organizationName}: a referral letter from your visit is ready in MyHealth. Sign in to see it and download the letter.`,
          };
      }
    },
  }),
  defineTemplate({
    key: "records.request-new",
    version: 1,
    category: "administrative",
    // In-app to the records office. The request number only: what was asked is read in the request, behind access control.
    channels: ["in_app"],
    variables: z.object({ requestId: z.uuid(), requestNumber: z.string().regex(/^RR\d{8}$/) }),
    render: (v) => ({
      subject: `New records request ${v.requestNumber}`,
      text: `A patient asked for copies of their records (${v.requestNumber}). Review it and share the documents or decline with a reason.`,
      href: `/records/requests/${v.requestId}`,
    }),
  }),
  defineTemplate({
    key: "appointment.waitlist-opened",
    version: 1,
    category: "administrative",
    // Leaves the platform (SMS/email): the clinic and the day only — no doctor, time or reason.
    channels: ["sms", "email"],
    variables: z.object({ facilityName: shortText, date: shortText }),
    render: (v) => ({
      subject: "A time may have opened",
      text: `${v.facilityName}: a time may have opened on ${v.date}. Sign in to MyHealth to book it. Times go to whoever books first.`,
    }),
  }),
  defineTemplate({
    key: "portal.push-test",
    version: 1,
    category: "administrative",
    // Sent when a patient asks "send me a test": to show that notifications reach this device. Nothing about care.
    channels: ["push"],
    internal: true,
    variables: z.object({ organizationName: shortText }),
    render: (v) => ({
      subject: "Notifications are on",
      text: `${v.organizationName}: this is a test. MyHealth notifications reach this device.`,
      href: "/notification-settings",
    }),
  }),
  defineTemplate({
    key: "portal.message-received",
    version: 1,
    category: "administrative",
    // Leaves the platform (SMS/email): no name, subject or words of the message — only that one is waiting in MyHealth.
    channels: ["sms", "email", "push"],
    variables: z.object({ organizationName: shortText }),
    render: (v) => ({
      subject: "You have a new message",
      text: `${v.organizationName}: you have a new message in MyHealth. Sign in to read it.`,
    }),
  }),
  defineTemplate({
    key: "portal.message-new",
    version: 1,
    category: "administrative",
    // In-app to the clinic's staff. No name and no text: the conversation is read behind access control.
    channels: ["in_app"],
    variables: z.object({ threadId: z.uuid() }),
    render: (v) => ({
      subject: "New message from a patient",
      text: "A patient wrote to the clinic in MyHealth. Open the conversation to read it and reply.",
      href: `/messages/${v.threadId}`,
    }),
  }),
  defineTemplate({
    key: "clinic.referral-notice",
    version: 1,
    category: "clinical",
    // In-app between practitioners. The referral number only: the patient and the reason are read in the referral.
    channels: ["in_app"],
    variables: z.object({
      referralId: z.uuid(),
      referralNumber: z.string().regex(/^RF\d{8}$/),
      kind: z.enum(["new", "accepted", "declined", "completed"]),
    }),
    render: (v) => ({
      subject:
        v.kind === "new"
          ? `New referral ${v.referralNumber}`
          : `Referral ${v.referralNumber} ${v.kind === "accepted" ? "accepted" : v.kind === "declined" ? "declined" : "completed"}`,
      text:
        v.kind === "new"
          ? `A patient was referred to you (${v.referralNumber}). Accept or decline it.`
          : v.kind === "declined"
            ? `Your referral ${v.referralNumber} was declined. Read the reason and refer elsewhere if needed.`
            : v.kind === "accepted"
              ? `Your referral ${v.referralNumber} was accepted.`
              : `Your referral ${v.referralNumber} was completed. Read the outcome in the referral.`,
      href: `/clinic/referrals/${v.referralId}`,
    }),
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
  defineTemplate({
    key: "lab.quality-notice",
    version: 1,
    category: "administrative",
    // In-app to the facility's quality managers. No patient, specimen or control values — the record is read behind access control.
    channels: ["in_app"],
    variables: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("nonconformance"),
        nonconformanceId: z.uuid(),
        number: z.string().regex(/^NC\d{8}$/),
        category: z.enum(Object.keys(NONCONFORMANCE_CATEGORY_LABEL) as [keyof typeof NONCONFORMANCE_CATEGORY_LABEL]),
        severity: z.enum(["minor", "major", "critical"]),
      }),
      z.object({
        kind: z.literal("qc_rejected"),
        instrumentCode: shortText,
        testName: shortText,
        rules: z.array(z.string().regex(/^[0-9A-Za-z_]{2,8}$/)).max(6),
      }),
      z.object({ kind: z.literal("temperature_due"), storageUnitCode: shortText, storageUnitName: shortText }),
      z.object({
        kind: z.literal("reagent_low"),
        instrumentCode: shortText,
        itemName: shortText,
        lotNumber: shortText.nullable(),
        remaining: z.number().int(),
        capacity: z.number().int().positive(),
      }),
      z.object({
        kind: z.literal("competency_due"),
        staffName: shortText,
        areaName: shortText,
        dueOn: z.iso.date(),
        /** The message goes to the person to be reassessed (otherwise to a quality manager). */
        forSelf: z.boolean(),
      }),
    ]),
    render: (v) => {
      switch (v.kind) {
        case "nonconformance":
          return {
            subject: `${v.severity === "minor" ? "Nonconformance" : `${v.severity === "critical" ? "Critical" : "Major"} nonconformance`} ${v.number}`,
            text: `${NONCONFORMANCE_CATEGORY_LABEL[v.category]} nonconformance ${v.number} (${v.severity}) was opened. Open it to investigate and record the corrective action.`,
            href: `/laboratory/nonconformances/${v.nonconformanceId}`,
          };
        case "qc_rejected":
          return {
            subject: `QC rejected — ${v.testName} on ${v.instrumentCode}`,
            text: `A QC run for ${v.testName} on instrument ${v.instrumentCode} was rejected${v.rules.length ? ` (${v.rules.join(", ")})` : ""}. Review the run and record a corrective action.`,
            href: "/laboratory/qc",
          };
        case "reagent_low":
          return {
            subject: `Reagent running low — ${v.itemName} on ${v.instrumentCode}`,
            text:
              v.remaining > 0
                ? `${v.itemName} lot ${v.lotNumber ?? "(no lot number)"} on instrument ${v.instrumentCode} has about ${v.remaining} of ${v.capacity} tests left. Prepare the next lot.`
                : `${v.itemName} lot ${v.lotNumber ?? "(no lot number)"} on instrument ${v.instrumentCode} has used all ${v.capacity} tests it was said to hold. Load the next lot or check the stated capacity.`,
            href: "/laboratory/instruments",
          };
        case "temperature_due":
          return {
            subject: `Temperature reading due — ${v.storageUnitName}`,
            text: `The temperature of ${v.storageUnitName} (${v.storageUnitCode}) has not been recorded within its reading interval. Record a reading.`,
            href: "/laboratory/temperatures",
          };
        case "competency_due":
          return {
            subject: v.forSelf ? `Your competency reassessment is due — ${v.areaName}` : `Competency reassessment due — ${v.staffName}`,
            text: v.forSelf
              ? `Your competency assessment for ${v.areaName} was due for reassessment on ${v.dueOn}. Ask your section head to reassess you.`
              : `${v.staffName}'s competency assessment for ${v.areaName} was due for reassessment on ${v.dueOn}.`,
            href: "/laboratory/competency",
          };
      }
    },
  }),
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [TemplateKey, ...TemplateKey[]];

/** The variables with the template's secret ones blanked, for storing a notification whose credential has been used. */
export function withoutSecrets(template: NotificationTemplate, variables: Record<string, unknown>): Record<string, unknown> {
  if (!template.secretVariables?.length) return variables;
  return Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, template.secretVariables!.includes(k) ? "[removed]" : v]));
}

/** What each message is about, for staff lists (communication log, patient history). Never the message itself. */
export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  "patient.registered": "Welcome after registration",
  "appointment.reminder": "Appointment reminder",
  "appointment.self-service": "Booking made, moved or cancelled in MyHealth",
  "appointment.no-show": "Missed appointment follow-up",
  "care-plan.follow-up-due": "Care-plan follow-up due",
  "clinic.message": "Notice from the clinic (MyHealth)",
  "security.mfa-enabled": "Two-step verification turned on",
  "portal.password-reset": "MyHealth password reset link",
  "portal.password-changed": "MyHealth password changed",
  "portal.email-verification": "MyHealth email verification code",
  "portal.security-alert": "MyHealth security alert",
  "staff.message": "Staff message",
  "lab.results-available": "Results ready in MyHealth",
  "dental.record-update": "Dental record update in MyHealth",
  "records.update": "Records update in MyHealth",
  "records.request-new": "New records request (staff)",
  "appointment.waitlist-opened": "Waiting list: a time may have opened",
  "portal.push-test": "Push notification test",
  "portal.message-received": "A MyHealth message is waiting",
  "portal.message-new": "New MyHealth message (staff)",
  "clinic.referral-notice": "Referral notice (staff)",
  "lab.result-notice": "Laboratory result notice (staff)",
  "lab.quality-notice": "Laboratory quality notice (staff)",
};

export function templateLabel(key: string): string {
  return (TEMPLATE_LABEL as Record<string, string>)[key] ?? key;
}

export function findTemplate(key: string): NotificationTemplate | undefined {
  return (TEMPLATES as readonly NotificationTemplate[]).find((t) => t.key === key);
}
