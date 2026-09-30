import { Logger } from "@nestjs/common";
import type { AppConfig } from "@healthcare/core";
import { PermanentDeliveryError } from "../notification.dispatcher";
import type { ChannelSender, SendContext, SendResult } from "../ports";
import type { RenderedMessage } from "../templates";
import { type ExpoPushTransport, expoTokenIsGone } from "./expo-push.transport";
import { PushSubscriptionService } from "./push-subscription.service";
import type { PushSubscriptionRecord } from "./push-subscription.schema";

/** Sends one encrypted push message to one browser address. Replaceable in tests. */
export interface WebPushTransport {
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { ttlSeconds: number; urgency: "normal" | "low" },
  ): Promise<{ statusCode: number }>;
}

/** The `web-push` library (RFC 8291 encryption, VAPID authentication) behind {@link WebPushTransport}. */
export class LibraryWebPushTransport implements WebPushTransport {
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  async send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { ttlSeconds: number; urgency: "normal" | "low" },
  ) {
    const webpush = await import("web-push");
    try {
      const result = await webpush.sendNotification(subscription, payload, { TTL: options.ttlSeconds, urgency: options.urgency, vapidDetails: this.vapid });
      return { statusCode: result.statusCode };
    } catch (error) {
      // The push service's refusal is a status code, not an exception for the caller to interpret.
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (typeof statusCode === "number") return { statusCode };
      throw error;
    }
  }
}

/** What the phone shows: a title and one line, both from a template that may leave the platform (no clinical detail). */
export function pushPayload(message: RenderedMessage): string {
  return JSON.stringify({ title: message.subject ?? "MyHealth", body: message.text, url: message.href ?? "/messages" });
}

/**
 * Push to a MyHealth account's devices (docs/domains/notification.md, "Push"). The notification's destination is the
 * account id; the message goes to every active device of the account — browsers through Web Push, the mobile app through
 * the Expo push service — for whichever of the two the platform has set up. It counts as sent when at least one device's
 * push service accepted it. A device that is gone (404/410, or `DeviceNotRegistered`) or keeps failing is dropped; when every
 * device failed for a reason that may pass, the notification is retried; when none is left it fails for good.
 */
export class WebPushSender implements ChannelSender {
  readonly channel = "push" as const;
  private readonly logger = new Logger(WebPushSender.name);

  constructor(
    private readonly devices: PushSubscriptionService,
    private readonly web: WebPushTransport | undefined,
    private readonly expo?: ExpoPushTransport,
  ) {}

  async send(destination: string, message: RenderedMessage, context?: SendContext): Promise<SendResult> {
    const subscriptions = (await this.devices.active(destination)).filter((s) => (s.kind === "expo" ? this.expo : this.web));
    if (subscriptions.length === 0) throw new PermanentDeliveryError("No device is registered for push any more");
    const outcome = { accepted: 0, retryable: 0 };
    await this.sendWeb(
      subscriptions.filter((s) => s.kind === "web"),
      message,
      outcome,
    );
    await this.sendExpo(
      subscriptions.filter((s) => s.kind === "expo"),
      message,
      outcome,
      context,
    );
    if (outcome.accepted > 0) return { provider: "push", providerMessageId: `${outcome.accepted}/${subscriptions.length} devices` };
    if (outcome.retryable > 0) throw new Error("The push service did not accept the message; it will be retried");
    throw new PermanentDeliveryError("Every registered device is gone");
  }

  private async sendWeb(subscriptions: PushSubscriptionRecord[], message: RenderedMessage, outcome: { accepted: number; retryable: number }): Promise<void> {
    if (!this.web) return;
    const payload = pushPayload(message);
    for (const s of subscriptions) {
      try {
        const { statusCode } = await this.web.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh ?? "", auth: s.auth ?? "" } }, payload, {
          ttlSeconds: 86_400,
          urgency: "normal",
        });
        if (statusCode >= 200 && statusCode < 300) {
          outcome.accepted += 1;
          await this.devices.recordResult(s.id, "sent");
        } else if (statusCode === 404 || statusCode === 410) {
          await this.devices.recordResult(s.id, "gone");
        } else {
          outcome.retryable += 1;
          await this.devices.recordResult(s.id, "failed");
          this.logger.warn(`Push to device ${s.id} was refused with status ${statusCode}`);
        }
      } catch (error) {
        outcome.retryable += 1;
        await this.devices.recordResult(s.id, "failed");
        this.logger.warn(`Push to device ${s.id} failed: ${String(error)}`);
      }
    }
  }

  private async sendExpo(
    subscriptions: PushSubscriptionRecord[],
    message: RenderedMessage,
    outcome: { accepted: number; retryable: number },
    context: SendContext | undefined,
  ): Promise<void> {
    if (!this.expo || subscriptions.length === 0) return;
    const { title, body, url } = JSON.parse(pushPayload(message)) as { title: string; body: string; url: string };
    try {
      const tickets = await this.expo.send(
        subscriptions.map((s) => ({ to: s.endpoint, title, body, data: { url }, sound: "default", channelId: "default", ttl: 86_400, priority: "high" })),
      );
      for (const [i, s] of subscriptions.entries()) {
        const ticket = tickets[i]!;
        if (ticket.status === "ok") {
          outcome.accepted += 1;
          await this.devices.recordResult(s.id, "sent");
          // Whether Apple or Google then took it comes later, in the ticket's receipt (ExpoPushReceipts).
          if (ticket.id) await this.devices.recordTicket(s, ticket.id, context?.notificationId ?? null);
        } else if (expoTokenIsGone(ticket)) {
          await this.devices.recordResult(s.id, "gone");
        } else {
          outcome.retryable += 1;
          await this.devices.recordResult(s.id, "failed");
          this.logger.warn(`Push to device ${s.id} was refused: ${ticket.error ?? "unknown"}`);
        }
      }
    } catch (error) {
      for (const s of subscriptions) {
        outcome.retryable += 1;
        await this.devices.recordResult(s.id, "failed");
      }
      this.logger.warn(`Push through Expo failed: ${String(error)}`);
    }
  }
}

export function vapidFrom(config: AppConfig): { subject: string; publicKey: string; privateKey: string } | null {
  return config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT
    ? { subject: config.VAPID_SUBJECT, publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY }
    : null;
}
