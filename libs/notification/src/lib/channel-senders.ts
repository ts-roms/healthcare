import { Logger } from "@nestjs/common";
import type { AppConfig, Database } from "@healthcare/core";
import { createTransport, type Transporter } from "nodemailer";
import type { NotificationChannel } from "./notification.schema";
import type { ChannelSender, SendResult } from "./ports";
import { PushSubscriptionService } from "./push/push-subscription.service";
import { LibraryExpoPushTransport } from "./push/expo-push.transport";
import { LibraryWebPushTransport, vapidFrom, WebPushSender } from "./push/web-push.sender";
import type { RenderedMessage } from "./templates";

type ExternalChannel = Exclude<NotificationChannel, "in_app">;

/**
 * Development/test adapter: logs that a message would be sent, with the
 * destination masked and without the message body (it may identify a patient).
 */
export class LoggingSender implements ChannelSender {
  private readonly logger = new Logger(`LoggingSender:${this.channel}`);
  readonly sent: Array<{ destination: string; message: RenderedMessage }> = [];

  constructor(readonly channel: ExternalChannel) {}

  async send(destination: string, message: RenderedMessage): Promise<SendResult> {
    this.sent.push({ destination, message });
    this.logger.log(`Would send ${this.channel} to ***${destination.slice(-4)} (${message.text.length} chars)`);
    return { provider: "log", providerMessageId: `log-${this.sent.length}` };
  }
}

/**
 * Production placeholder for channels whose provider has not been selected
 * (see docs/interoperability/dependencies.md). Fails loudly instead of
 * pretending to deliver.
 */
export class UnconfiguredSender implements ChannelSender {
  constructor(readonly channel: ExternalChannel) {}

  async send(): Promise<SendResult> {
    throw new Error(`No ${this.channel} provider is configured`);
  }
}

export class SmtpEmailSender implements ChannelSender {
  readonly channel = "email" as const;
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(destination: string, message: RenderedMessage): Promise<SendResult> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: destination,
      subject: message.subject ?? "Notification",
      text: message.text,
    });
    return { provider: "smtp", providerMessageId: info.messageId };
  }
}

export function defaultChannelSenders(config: AppConfig, db?: Database): ChannelSender[] {
  const fallback = (channel: ExternalChannel): ChannelSender =>
    config.NODE_ENV === "production" ? new UnconfiguredSender(channel) : new LoggingSender(channel);
  return [
    // SMS and push providers are integration dependencies; add adapters here once selected.
    fallback("sms"),
    // Push is Web Push to patients' browsers (our VAPID key pair) and the Expo push service for the MyHealth mobile app
    // (EXPO_PUSH_ENABLED): neither needs a provider account of its own.
    pushSender(config, db) ?? fallback("push"),
    config.SMTP_URL ? new SmtpEmailSender(config.SMTP_URL, config.EMAIL_FROM) : fallback("email"),
  ];
}

function pushSender(config: AppConfig, db: Database | undefined): ChannelSender | undefined {
  const vapid = vapidFrom(config);
  if (!db || (!vapid && !config.EXPO_PUSH_ENABLED)) return undefined;
  return new WebPushSender(
    new PushSubscriptionService(db),
    vapid ? new LibraryWebPushTransport(vapid) : undefined,
    config.EXPO_PUSH_ENABLED ? new LibraryExpoPushTransport(config.EXPO_ACCESS_TOKEN) : undefined,
  );
}
