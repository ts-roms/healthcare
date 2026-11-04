import { claimAnswerSchema, type AgentJob, jobIdOf } from "./job";
import { ConfigError } from "./config";
import type { PrinterState } from "./printer";

/** The API answered something the agent should try again later (busy, down, rate limited): not a reason to stop. */
export class TransientApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The `Retry-After` the API sent, in seconds, when it sent one. */
    readonly retryAfterSeconds?: string,
  ) {
    super(message);
    this.name = "TransientApiError";
  }
}

/** The API refused one request (an unknown kiosk, a job that is not being printed): the agent logs it and carries on. */
export class ApiRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRefusedError";
  }
}

export interface ApiOptions {
  baseUrl: string;
  email: string;
  password: string;
  facilityId: string;
  organizationId?: string;
  fetchImpl?: typeof fetch;
  /** The clock, in milliseconds (tests). */
  now?: () => number;
}

/** How long the agent waits before signing in again after the API turned its sign-in away, when the API does not say. */
export const SIGN_IN_BACKOFF_MS = 30_000;
/** The longest it waits, whatever the API asks for. */
export const SIGN_IN_BACKOFF_MAX_MS = 120_000;

export type PrintOutcome = { outcome: "printed" } | { outcome: "failed"; error: "paper_out" | "offline" | "error"; retry: boolean };

/**
 * The agent's calls to the API, as its own restricted account. It signs in with an email and password (no two-step code: the
 * account holds only the print-agent role), keeps the access token in memory, and signs in again when it expires. It never
 * sends anything but device codes, job ids and results.
 */
export class AgentApi {
  private token: string | null = null;
  /** After a sign-in the API turned away (busy, rate limited), no new attempt is made before this time. */
  private signInBlockedUntil = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The next ticket for one kiosk's printer; null when nothing waits. A job the API sent that cannot be read comes back as `invalid`. */
  async claim(deviceCode: string): Promise<{ job: AgentJob } | { job: null } | { invalid: string | null }> {
    const raw = await this.request("/kiosk/print/claim", { deviceCode });
    const parsed = claimAnswerSchema.safeParse(raw);
    if (parsed.success) return parsed.data.job ? { job: parsed.data.job } : { job: null };
    return { invalid: jobIdOf(raw) };
  }

  async report(jobId: string, result: PrintOutcome): Promise<void> {
    await this.request(`/kiosk/print/jobs/${jobId}/result`, result);
  }

  async heartbeat(deviceCode: string, printerStatus: PrinterState): Promise<void> {
    await this.request("/kiosk/print/heartbeat", { deviceCode, printerStatus });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /**
   * Signs in. A sign-in the API turns away (rate limited, busy) is not tried again on the next poll — that would keep the
   * agent, and the clinic's other devices sharing the address, at the limit — but after the `Retry-After` the API gave,
   * or a short wait.
   */
  private async signIn(): Promise<string> {
    if (this.now() < this.signInBlockedUntil) throw new TransientApiError("Waiting before signing in again");
    try {
      return await this.signInOnce();
    } catch (error) {
      if (error instanceof TransientApiError && error.status !== undefined) {
        const asked = Number(error.retryAfterSeconds);
        const wait = Number.isFinite(asked) && asked > 0 ? asked * 1000 : SIGN_IN_BACKOFF_MS;
        this.signInBlockedUntil = this.now() + Math.min(wait, SIGN_IN_BACKOFF_MAX_MS);
      }
      throw error;
    }
  }

  private async signInOnce(): Promise<string> {
    const response = await this.send(
      "/auth/login",
      { email: this.options.email, password: this.options.password, organizationId: this.options.organizationId },
      null,
    );
    const body = (await response.json().catch(() => ({}))) as { accessToken?: string; status?: string };
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500)
        throw new TransientApiError("Sign-in is not available right now", response.status, response.headers.get("retry-after") ?? undefined);
      throw new ConfigError("The API refused the agent's sign-in: check AGENT_EMAIL, AGENT_PASSWORD and ORGANIZATION_ID");
    }
    if (body.status === "mfa_required")
      throw new ConfigError("The agent's account asks for a two-step code: an agent account must be exempted by an administrator");
    if (!body.accessToken) throw new TransientApiError("Sign-in gave no token");
    return body.accessToken;
  }

  private async send(path: string, body: unknown, token: string | null): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-facility-id": this.options.facilityId,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TransientApiError("The API could not be reached");
    }
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      this.token ??= await this.signIn();
      const response = await this.send(path, body, this.token);
      if (response.status === 401) {
        // The token expired or the session ended: sign in again once.
        this.token = null;
        continue;
      }
      if (response.status === 429 || response.status >= 500) throw new TransientApiError(`The API answered ${response.status}`, response.status);
      if (!response.ok) throw new ApiRefusedError(`The API refused ${path} (${response.status})`, response.status);
      return response.json().catch(() => ({}));
    }
    throw new TransientApiError("The API kept refusing the agent's session");
  }
}
