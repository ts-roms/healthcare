import type { NotificationCategory, NotificationChannel } from "./notification.schema";
import type { RenderedMessage } from "./templates";

export type Recipient = { type: "patient"; patientId: string } | { type: "user"; userId: string };

export type RecipientResolution = { allowed: true; destination: string | null } | { allowed: false; reason: string };

/**
 * Resolves where a message goes and whether the recipient allows it
 * (contact on file, consent, communication preferences). Implemented by the
 * application's composition root, which knows the patient and user domains.
 */
export interface RecipientDirectory {
  resolve(organizationId: string, recipient: Recipient, channel: NotificationChannel, category: NotificationCategory): Promise<RecipientResolution>;
}
export const RECIPIENT_DIRECTORY = Symbol("RECIPIENT_DIRECTORY");

/** Hands a stored notification to background delivery. */
export interface NotificationQueue {
  enqueue(notificationId: string, delayMs?: number): Promise<void>;
}
export const NOTIFICATION_QUEUE = Symbol("NOTIFICATION_QUEUE");

export interface SendResult {
  provider: string;
  providerMessageId?: string;
}

/** One adapter per external channel. Providers are replaceable (CLAUDE.md §19). */
export interface ChannelSender {
  readonly channel: Exclude<NotificationChannel, "in_app">;
  send(destination: string, message: RenderedMessage): Promise<SendResult>;
}
export const CHANNEL_SENDERS = Symbol("CHANNEL_SENDERS");
