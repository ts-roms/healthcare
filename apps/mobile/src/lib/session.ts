import { ApiError, SessionEndedError } from "./api-error";
import type { PortalMfaRequired, PortalTokenResponse } from "./api-types";

/**
 * The patient's MyHealth session on this device, over the API's token contract (`/api/v1/portal/auth/*`; see
 * docs/architecture/mobile-app.md, "Native client trace"). Platform-neutral: storage and `fetch` are injected, so the
 * rules are unit-tested in Node.
 *
 * - The access token lives in memory only. The refresh token is kept in the device's secure storage (`TokenStore`).
 * - Refresh is single-flight: the API rotates the refresh token and treats a second use of the old one as theft,
 *   revoking the session, so concurrent requests must share one refresh.
 * - The patient is signed out only when the API refuses the session (401 on refresh, or on a request right after a
 *   refresh). Other errors — 422 for a wrong code, 403, 429, 5xx, no network — are shown and the session is kept.
 * - The app never sends `X-Acting-For`: it acts only for the signed-in patient.
 */

export interface TokenStore {
  read(): Promise<string | null>;
  write(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export type SessionState = { status: "signed_in" } | { status: "signed_out"; reason: "signed_out" | "session_ended" | null };

export type SignInResult = "signed_in" | "code_required";

interface SessionOptions {
  baseUrl: string;
  organizationCode: string;
  store: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Refresh this long before the access token expires, so a request never races its expiry (the web portal does the same). */
const EXPIRY_MARGIN_MS = 30_000;

export class PatientSession {
  private access: { token: string; expiresAt: number } | null = null;
  private challenge: string | null = null;
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<(state: SessionState) => void>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: SessionOptions) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
  }

  get signedIn(): boolean {
    return this.access !== null;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** At app start: resumes a stored session. False when there is none or the API refused it; errors (e.g. offline) propagate. */
  async restore(): Promise<boolean> {
    if (!(await this.options.store.read())) return false;
    try {
      await this.refresh();
      return true;
    } catch (error) {
      if (error instanceof SessionEndedError) return false;
      throw error;
    }
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    this.challenge = null;
    const result = await this.postPublic<PortalTokenResponse | PortalMfaRequired>("/portal/auth/login", {
      organizationCode: this.options.organizationCode,
      email,
      password,
    });
    if (result.status === "mfa_required") {
      // Held in memory only; the API expires it after five minutes.
      this.challenge = result.challengeToken;
      return "code_required";
    }
    await this.start(result);
    return "signed_in";
  }

  /** The second step: a code from the authenticator app, or a recovery code. */
  async verifyCode(code: string): Promise<void> {
    if (!this.challenge) throw new ApiError(401, "challenge_missing", "Your sign-in took too long. Enter your password again.");
    const tokens = await this.postPublic<PortalTokenResponse>("/portal/auth/mfa/verify", { challengeToken: this.challenge, code });
    this.challenge = null;
    await this.start(tokens);
  }

  /** Ends the session at the API (best effort) and forgets it on this device either way. */
  async signOut(): Promise<void> {
    const token = this.access?.token;
    if (token) {
      try {
        await this.fetchImpl(`${this.options.baseUrl}/portal/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      } catch {
        // Offline: the device forgets the session; the API ends it when the refresh token expires.
      }
    }
    await this.end("signed_out");
  }

  /** An authenticated GET. Refreshes when needed, retries once after a 401, and ends the session if the API refuses it. */
  get<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET");
  }

  /** An authenticated POST, with the same refresh and sign-out rules as `get` (used for this phone's notifications). */
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, "POST", body);
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    await this.ensureAccess();
    let response = await this.authorized(path, method, body);
    if (response.status === 401) {
      await this.refresh();
      response = await this.authorized(path, method, body);
      if (response.status === 401) {
        await this.end("session_ended");
        throw new SessionEndedError();
      }
    }
    if (!response.ok) throw await ApiError.from(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private authorized(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.access?.token ?? ""}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  }

  private async ensureAccess(): Promise<void> {
    if (this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > this.now()) return;
    await this.refresh();
  }

  /** Single-flight: every caller waiting on an expired token shares the same refresh. */
  private refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = await this.options.store.read();
    if (!refreshToken) {
      await this.end("session_ended");
      throw new SessionEndedError();
    }
    let tokens: PortalTokenResponse;
    try {
      tokens = await this.postPublic<PortalTokenResponse>("/portal/auth/refresh", { refreshToken });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.end("session_ended");
        throw new SessionEndedError();
      }
      // Offline, rate-limited or a server error: keep the stored session and let the patient try again.
      throw error;
    }
    await this.save(tokens);
  }

  private async start(tokens: PortalTokenResponse): Promise<void> {
    await this.save(tokens);
    this.emit({ status: "signed_in" });
  }

  /** The rotated refresh token is stored before the new access token is used. */
  private async save(tokens: PortalTokenResponse): Promise<void> {
    await this.options.store.write(tokens.refreshToken);
    this.access = { token: tokens.accessToken, expiresAt: this.now() + tokens.expiresIn * 1000 };
  }

  private async end(reason: "signed_out" | "session_ended"): Promise<void> {
    const wasSignedIn = this.access !== null;
    this.access = null;
    this.challenge = null;
    await this.options.store.clear();
    if (wasSignedIn || reason === "signed_out") this.emit({ status: "signed_out", reason });
  }

  private emit(state: SessionState): void {
    for (const listener of this.listeners) listener(state);
  }

  /** An unauthenticated POST (sign-in, code, refresh). */
  private async postPublic<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await ApiError.from(response);
    return (await response.json()) as T;
  }
}
