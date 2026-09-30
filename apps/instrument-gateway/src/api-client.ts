/** Posts instrument messages to the platform API as the integration account (bearer token, refreshed when it expires). */
export type SubmitOutcome = { kind: "accepted"; duplicate: boolean } | { kind: "refused"; code: string } | { kind: "failed"; reason: string };

export class PlatformClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(
    private readonly config: { apiUrl: string; email: string; password: string; organizationId?: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async submit(instrumentId: string, message: string): Promise<SubmitOutcome> {
    try {
      let response = await this.post(instrumentId, message);
      if (response.status === 401) {
        await this.renew();
        response = await this.post(instrumentId, message);
      }
      if (response.ok) {
        const body = (await response.json()) as { duplicate?: boolean };
        return { kind: "accepted", duplicate: Boolean(body.duplicate) };
      }
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      if (response.status >= 400 && response.status < 500) return { kind: "refused", code: body.error?.code ?? `http_${response.status}` };
      return { kind: "failed", reason: `http_${response.status}` };
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : "unknown" };
    }
  }

  private async post(instrumentId: string, message: string): Promise<Response> {
    if (!this.accessToken) await this.renew();
    return this.fetchFn(`${this.config.apiUrl}/laboratory/instruments/${instrumentId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(20_000),
    });
  }

  /** Refreshes the session, or signs in again when there is none or the refresh is refused. */
  private async renew(): Promise<void> {
    if (this.refreshToken) {
      const refreshed = await this.fetchFn(`${this.config.apiUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
        signal: AbortSignal.timeout(20_000),
      });
      if (refreshed.ok && this.take(await refreshed.json())) return;
    }
    const login = await this.fetchFn(`${this.config.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.config.email, password: this.config.password, organizationId: this.config.organizationId }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await login.json().catch(() => ({}))) as unknown;
    if (!login.ok || !this.take(body)) {
      const status =
        (body as { status?: string; error?: { code?: string } }).status ?? (body as { error?: { code?: string } }).error?.code ?? `http_${login.status}`;
      throw new Error(`The integration account could not sign in (${status}); use an account without MFA that holds lab.instrument.message.submit`);
    }
  }

  private take(body: unknown): boolean {
    const tokens = body as { status?: string; accessToken?: string; refreshToken?: string };
    if (tokens.status !== "authenticated" || !tokens.accessToken || !tokens.refreshToken) return false;
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    return true;
  }
}
