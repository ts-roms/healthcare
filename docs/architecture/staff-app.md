# Staff app ↔ API

`apps/staff` is a Next.js **backend-for-frontend**: the browser talks only to the staff app's server, which calls the API (`apps/api`). Access and refresh tokens never reach browser JavaScript.

```
browser ──cookies──▶ staff app server (proxy.ts, server components, server actions)
                        │  Authorization: Bearer <access>   X-Facility-Id: <facility>
                        ▼
                     API /api/v1  ──▶ AccessGuard, permissions, audit
```

## Session

| Cookie   | Holds                               | Flags                                     | Lifetime                                |
| -------- | ----------------------------------- | ----------------------------------------- | --------------------------------------- |
| `hc_at`  | Access token                        | httpOnly, SameSite=Lax, Secure in prod    | Token TTL minus 30 s                    |
| `hc_rt`  | Refresh token                       | httpOnly, SameSite=Strict, Secure in prod | Until the API's `refreshTokenExpiresAt` |
| `hc_mfa` | MFA challenge token (between steps) | httpOnly, SameSite=Strict                 | 5 minutes, cleared on success           |
| `hc_fac` | Selected facility id (not a secret) | httpOnly, SameSite=Lax                    | Session                                 |

- **Sign-in** (`app/(auth)/login/actions.ts`): `POST /auth/login` → tokens, or `mfa_required` (then `POST /auth/mfa/verify`), or `organization_selection_required` (the user picks an organization and re-enters the password). With exactly one active facility it is selected automatically.
- **Gate and refresh** (`src/proxy.ts`): no refresh token → `/login?next=…` (same-origin paths only). No access token (its cookie expired) → `POST /auth/refresh`, and the new tokens go to both the current render and the browser.
- **Single-flight refresh** (`lib/api/tokens.ts`): the API rotates refresh tokens and **revokes the session when a rotated token is reused**. Parallel requests from one browser can all carry the same expired token, so concurrent refreshes of one token share a single API call, and the result is reused for 30 s. This is per process: running several staff-app instances needs sticky sessions or a shared store (e.g. Redis) for the same guarantee.
- **Refresh failures:** only a definitive rejection (invalid, expired or revoked token) signs the user out. A rate limit (429), server error or network failure returns a 503 "service is busy" page that retries itself, and the session cookies are kept.
- **Client identity** (`lib/api/forwarding.ts`): every call to the API forwards the browser's IP (`X-Forwarded-For`, right-most entry as seen by the staff app) and user agent, so the API's per-client rate limits and the audit trail see the real client rather than the staff server. The API must run with `TRUST_PROXY=true` and **must not be reachable directly** (only through the staff app or a trusted proxy), otherwise clients could spoof the header.
- **API calls** (`lib/api/client.ts`, server-only): send the bearer token and `X-Facility-Id`; a `401` sends the user to sign in again; other errors become `ApiError` with the API's `code`, `message`, `details` and `requestId`.
- **Sign-out**: `POST /auth/logout` (revokes the session), then cookies are cleared.

Authorization is always the API's: the staff app hides what the user can't do (navigation from `GET /auth/me` permissions, buttons via `can()`), but every request is checked server-side by the API.

## Data

| Area                                                                                                                        | Source                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Sign-in, navigation, facility, patient lookup, patient record, registration                                                 | API                                                        |
| Appointments, queue, clinic/encounters, laboratory, dental, telemedicine, dashboard clinical panels, `/preview/patient-360` | `lib/demo-data.ts` fixtures, badged **Demo** with a banner |

The API has no clinical record yet (Phase 2), so real patient pages show **"Allergies not recorded"** and a "Clinical record — not available yet" panel. Fixture clinical data is never shown next to a real patient.

Response types are mirrored in `lib/api/types.ts` because `layer:ui` projects may not import backend libraries. Move them into `type:contract` libraries, or generate them from the OpenAPI document, as domains grow.

## Configuration

`API_BASE_URL` (server-side, default `http://localhost:3000/api/v1`). The API's `CORS_ORIGINS` is irrelevant to the staff app's server-to-server calls but still lists the web origins for any direct browser use.
