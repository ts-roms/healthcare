import { Logger } from "@nestjs/common";
import type { AppConfig } from "@healthcare/core";
import { PermanentDeliveryError } from "../notification.dispatcher";
import type { ChannelSender, SendResult } from "../ports";
import type { RenderedMessage } from "../templates";
import { PushSubscriptionService } from "./push-subscription.service";

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
 * account id; the message goes to every active device of the account. It counts as sent when at least one device's push
 * service accepted it. A device that is gone (404/410) or keeps failing is dropped; when every device failed for a reason
 * that may pass, the notification is retried; when none is left it fails for good.
 */
export class WebPushSender implements ChannelSender {
  readonly channel = "push" as const;
  private readonly logger = new Logger(WebPushSender.name);

  constructor(
    private readonly devices: PushSubscriptionService,
    private readonly transport: WebPushTransport,
  ) {}

  async send(destination: string, message: RenderedMessage): Promise<SendResult> {
    const subscriptions = await this.devices.active(destination);
    if (subscriptions.length === 0) throw new PermanentDeliveryError("No device is registered for push any more");
    const payload = pushPayload(message);
    let accepted = 0;
    let retryable = 0;
    for (const s of subscriptions) {
      try {
        const { statusCode } = await this.transport.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          ttlSeconds: 86_400,
          urgency: "normal",
        });
        if (statusCode >= 200 && statusCode < 300) {
          accepted += 1;
          await this.devices.recordResult(s.id, "sent");
        } else if (statusCode === 404 || statusCode === 410) {
          await this.devices.recordResult(s.id, "gone");
        } else {
          retryable += 1;
          await this.devices.recordResult(s.id, "failed");
          this.logger.warn(`Push to device ${s.id} was refused with status ${statusCode}`);
        }
      } catch (error) {
        retryable += 1;
        await this.devices.recordResult(s.id, "failed");
        this.logger.warn(`Push to device ${s.id} failed: ${String(error)}`);
      }
    }
    if (accepted > 0) return { provider: "webpush", providerMessageId: `${accepted}/${subscriptions.length} devices` };
    if (retryable > 0) throw new Error("The push service did not accept the message; it will be retried");
    throw new PermanentDeliveryError("Every registered device is gone");
  }
}

export function vapidFrom(config: AppConfig): { subject: string; publicKey: string; privateKey: string } | null {
  return config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT
    ? { subject: config.VAPID_SUBJECT, publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY }
    : null;
}
