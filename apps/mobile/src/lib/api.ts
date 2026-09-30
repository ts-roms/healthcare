import type { MfaRequired, StoredSession, TokenResponse } from "./types";

/** Where the signed-in session is kept (the phone's secure storage in the app; a fake in tests). */
export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** The API refused the request; `code` is the API's own error code (`invalid_credentials`, `too_many_push_devices`, …). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never got an answer (no connection, a timeout). The session is kept. */
export class NetworkError extends Error {
  constructor() {
    super("Could not reach MyHealth. Check your connection and try again.");
    this.name = "NetworkError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  organizationCode: string;
  store: SessionStore;
  fetch?: typeof fetch;
  /** Called once when the session ended for good (the refresh token was refused): the app goes back to sign-in. */
  onSignedOut?: () => void;
  now?: () => number;
}

export type LoginResult = { kind: "signed_in" } | { kind: "mfa_required"; challengeToken: string };

/**
 * The patient's API (`/api/v1/portal/*`) as the app uses it. Tokens live in the store; a request that gets 401 refreshes
 * the session once (all callers share that one refresh) and repeats. A refresh the API refuses ends the session; a
 * refresh that could not be attempted (offline) does not.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  let refreshing: Promise<StoredSession | null> | null = null;

  async function call(path: string, init: { method?: string; body?: unknown; token?: string }): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new NetworkError();
    }
  }

  async function failure(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return new ApiError(response.status, body?.error?.code ?? "error", body?.error?.message ?? "Something went wrong. Try again.");
  }

  async function persist(tokens: TokenResponse): Promise<StoredSession> {
    const session = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt };
    await options.store.save(session);
    return session;
  }

  /** null: the API refused the refresh token, the session is over. */
  async function doRefresh(stale: StoredSession): Promise<StoredSession | null> {
    if (new Date(stale.refreshTokenExpiresAt).getTime() <= (options.now ?? Date.now)()) return null;
    const response = await call("/portal/auth/refresh", { method: "POST", body: { refreshToken: stale.refreshToken } });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw await failure(response);
    return persist((await response.json()) as TokenResponse);
  }

  /** Callers that hit 401 together share one refresh (the refresh token rotates: a second one would end the session). */
  function refresh(stale: StoredSession): Promise<StoredSession | null> {
    if (!refreshing) {
      refreshing = doRefresh(stale).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let session = await options.store.load();
    if (!session) {
      options.onSignedOut?.();
      throw new ApiError(401, "not_signed_in", "Sign in to continue.");
    }
    let response = await call(path, { ...init, token: session.accessToken });
    if (response.status === 401) {
      const renewed = await refresh(session);
      if (!renewed) {
        await options.store.clear();
        options.onSignedOut?.();
        throw new ApiError(401, "session_ended", "Your session has ended. Sign in again.");
      }
      session = renewed;
      response = await call(path, { ...init, token: session.accessToken });
    }
    if (!response.ok) throw await failure(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async login(email: string, password: string): Promise<LoginResult> {
      const response = await call("/portal/auth/login", {
        method: "POST",
        body: { organizationCode: options.organizationCode, email: email.trim(), password },
      });
      if (!response.ok) throw await failure(response);
      const body = (await response.json()) as TokenResponse | MfaRequired;
      if (body.status === "mfa_required") return { kind: "mfa_required", challengeToken: body.challengeToken };
      await persist(body);
      return { kind: "signed_in" };
    },
    async verifyMfa(challengeToken: string, code: string): Promise<void> {
      const response = await call("/portal/auth/mfa/verify", { method: "POST", body: { challengeToken, code: code.trim() } });
      if (!response.ok) throw await failure(response);
      await persist((await response.json()) as TokenResponse);
    },
    /** Ends the session on the server (best effort) and here. */
    async logout(): Promise<void> {
      const session = await options.store.load();
      if (session) await call("/portal/auth/logout", { method: "POST", token: session.accessToken }).catch(() => undefined);
      await options.store.clear();
    },
    hasSession: async () => (await options.store.load()) !== null,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
