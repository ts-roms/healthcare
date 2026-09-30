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

/** What Apple or Google did with a message, as Expo reports it later for a ticket id. */
export type ExpoPushReceipt = { status: "ok" } | { status: "error"; message?: string; error?: string };

/** Sends messages to phones through the Expo push service, and reads their receipts. Replaceable in tests. */
export interface ExpoPushTransport {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  /** Receipts for these ticket ids (at most 1,000 per call). Ids with no receipt yet, or any more, are absent. */
  receipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>>;
}

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo takes up to 1,000 ids per receipts request. */
export const EXPO_RECEIPTS_BATCH = 1000;

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
    private readonly receiptsUrl: string = EXPO_RECEIPTS_URL,
  ) {}

  private post(url: string, body: unknown): Promise<Response> {
    return this.fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async receipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
    if (ticketIds.length === 0) return {};
    if (ticketIds.length > EXPO_RECEIPTS_BATCH) throw new Error(`At most ${EXPO_RECEIPTS_BATCH} receipts per request`);
    const response = await this.post(this.receiptsUrl, { ids: ticketIds });
    if (!response.ok) throw new Error(`The Expo push service answered ${response.status}`);
    const body = (await response.json()) as { data?: Record<string, { status?: string; message?: string; details?: { error?: string } }> };
    if (typeof body.data !== "object" || body.data === null) throw new Error("The Expo push service answered in an unexpected shape");
    const out: Record<string, ExpoPushReceipt> = {};
    for (const [id, r] of Object.entries(body.data)) {
      out[id] = r.status === "ok" ? { status: "ok" } : { status: "error", message: r.message, error: r.details?.error };
    }
    return out;
  }

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const response = await this.post(this.url, messages);
    if (!response.ok) throw new Error(`The Expo push service answered ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> };
    if (!Array.isArray(body.data) || body.data.length !== messages.length) throw new Error("The Expo push service answered in an unexpected shape");
    return body.data.map((t) => (t.status === "ok" ? { status: "ok", id: t.id } : { status: "error", message: t.message, error: t.details?.error }));
  }
}

/** Errors that mean the token will never work again (the app was removed or the token changed). */
export function expoTokenIsGone(answer: ExpoPushTicket | ExpoPushReceipt): boolean {
  return answer.status === "error" && answer.error === "DeviceNotRegistered";
}

/**
 * Receipt errors that are the platform's own setup, not the phone's (Apple or Firebase credentials, sender id): they are
 * logged for the operator and never counted against the patient's device.
 */
export function expoErrorIsConfiguration(receipt: ExpoPushReceipt): boolean {
  return receipt.status === "error" && (receipt.error === "InvalidCredentials" || receipt.error === "MismatchSenderId");
}
