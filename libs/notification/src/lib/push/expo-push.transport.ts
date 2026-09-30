/** One message for the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: "default";
  channelId: "default";
  ttl: number;
  priority: "default" | "high";
}

/** What Expo's service answered for one message: accepted, or refused with a reason. */
export type ExpoPushTicket = { status: "ok"; id?: string } | { status: "error"; message?: string; error?: string };

/** Sends messages to phones through the Expo push service. Replaceable in tests. */
export interface ExpoPushTransport {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";

/**
 * The Expo push service over HTTPS. It needs no account for sending; an access token (`EXPO_ACCESS_TOKEN`) is only for
 * projects that turned on "enhanced security". A transport failure (network, 5xx, rate limit) throws so the notification is
 * retried; the service's per-message refusals come back as tickets.
 */
export class LibraryExpoPushTransport implements ExpoPushTransport {
  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly url: string = EXPO_SEND_URL,
  ) {}

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The Expo push service answered ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> };
    if (!Array.isArray(body.data) || body.data.length !== messages.length) throw new Error("The Expo push service answered in an unexpected shape");
    return body.data.map((t) => (t.status === "ok" ? { status: "ok", id: t.id } : { status: "error", message: t.message, error: t.details?.error }));
  }
}

/** Errors that mean the token will never work again (the app was removed or the token changed). */
export function expoTokenIsGone(ticket: ExpoPushTicket): boolean {
  return ticket.status === "error" && ticket.error === "DeviceNotRegistered";
}
