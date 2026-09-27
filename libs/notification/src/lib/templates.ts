import { z } from 'zod';
import type { NotificationCategory, NotificationChannel } from './notification.schema';

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
    key: 'patient.registered',
    version: 1,
    category: 'administrative',
    channels: ['sms', 'email'],
    variables: z.object({ givenName: shortText, organizationName: shortText, patientNumber: z.string().regex(/^P\d{8}$/) }),
    render: (v) => ({
      subject: `Welcome to ${v.organizationName}`,
      text: `Hi ${v.givenName}, you are now registered at ${v.organizationName}. Your patient number is ${v.patientNumber}.`,
    }),
  }),
  defineTemplate({
    key: 'security.mfa-enabled',
    version: 1,
    category: 'security',
    channels: ['email', 'in_app'],
    variables: z.object({ displayName: shortText }),
    render: (v) => ({
      subject: 'Two-step verification was turned on',
      text: `Hi ${v.displayName}, two-step verification was turned on for your account. If this was not you, contact your administrator immediately.`,
    }),
  }),
  defineTemplate({
    key: 'staff.message',
    version: 1,
    category: 'administrative',
    // In-app only: free text written by staff stays inside the platform.
    channels: ['in_app'],
    variables: z.object({ title: shortText, body: z.string().trim().min(1).max(2000) }),
    render: (v) => ({ subject: v.title, text: v.body }),
  }),
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]['key'];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [TemplateKey, ...TemplateKey[]];

export function findTemplate(key: string): NotificationTemplate | undefined {
  return (TEMPLATES as readonly NotificationTemplate[]).find((t) => t.key === key);
}
