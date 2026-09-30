# Mobile app — requirements and status

**Status: first slice built** — patients sign in, read their released results and can receive push notifications on the phone (`apps/mobile`, [§7](#7-first-slice-apps-mobile); push is a provisional D6 choice, [§8](#8-push-to-the-app-provisional-d6)). Only
what the decisions in [§4](#4-decisions-needed-before-implementation) cover may be built; the rest waits for its decision. This note separates
what the repository already establishes from what still has to be decided; it does not add requirements of its own.

Evidence labels: **VERIFIED** (read in the repository), **PARTIALLY VERIFIED** (exists, incomplete or not checked end to end), **NOT FOUND**
(searched, absent), **UNKNOWN** (needs a decision).

## 1. What is documented today

| Statement                                                                                                | Source                                                    | Label                               |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Mobile uses React Native + Expo, "primarily for patients".                                               | `CLAUDE.md` §1                                            | VERIFIED                            |
| `apps/mobile` is **planned**; no other mobile project is listed.                                         | `CLAUDE.md` §3                                            | VERIFIED                            |
| The patient is served by a "simple mobile experience".                                                   | `CLAUDE.md` §29                                           | VERIFIED                            |
| Zod schemas "can later be shared with the Next.js and Expo clients".                                     | `docs/architecture/decisions.md` (validation ADR)         | VERIFIED                            |
| A push provider for a mobile app (e.g. Expo push) is a dependency; production uses `UnconfiguredSender`. | `docs/interoperability/dependencies.md`                   | VERIFIED                            |
| Not built: a mobile app (Expo/FCM/APNs), push for staff.                                                 | `docs/domains/notification.md`, `portal-app.md` "Not yet" | VERIFIED                            |
| Offline support: "design for eventual offline support" (registration, queue, vitals — staff workflows).  | `CLAUDE.md` §30                                           | VERIFIED (not a mobile requirement) |
| Which patient workflows the app must support, release scope, device capabilities.                        | —                                                         | NOT FOUND                           |

There is no `apps/mobile`, and no `react-native`, `expo`, `expo-router` or `@react-navigation` dependency anywhere in the workspace (NOT FOUND).

## 2. What already exists that a patient app would use

### Authentication (VERIFIED, `libs/patient/src/lib/portal`)

The API side of MyHealth sign-in is a token contract, not a cookie contract. Cookies (`hp_at`, `hp_rt`) belong to the Next.js portal server
only ([portal-app.md](portal-app.md#session)).

| Endpoint                                             | Contract                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /portal/auth/activate`                         | Patient number + date of birth + clinic-issued code, then email and password. `organizationCode` in the body.                                                                                             |
| `POST /portal/auth/login`                            | `{ organizationCode, email, password }` → `{ status: "authenticated", accessToken, tokenType: "Bearer", expiresIn, refreshToken, refreshTokenExpiresAt }` or `{ status: "mfa_required", challengeToken }` |
| `POST /portal/auth/mfa/verify`                       | Challenge token + authenticator or recovery code → the same token response.                                                                                                                               |
| `POST /portal/auth/refresh`                          | `{ refreshToken }` in the body; the refresh token rotates, and reusing a rotated one revokes the session.                                                                                                 |
| `POST /portal/auth/logout`                           | Bearer token; ends the session.                                                                                                                                                                           |
| `POST /portal/auth/password-reset/{request,confirm}` | The emailed link points at `PORTAL_BASE_URL` (`/reset-password#token=…`), i.e. the web portal.                                                                                                            |

Tokens carry the `healthcare-portal` audience and are checked per request by `PatientAccessGuard` (session, account and `portal_access`
consent). A session records the caller's IP and user agent; there is no device model for sessions.

### Native client trace (VERIFIED, 2026-09-30)

The contract was exercised against a locally running API (migrations through `0080`, seeded `demo` organization) by a script acting as a native
app: `fetch` with a bearer header and JSON bodies, an app `User-Agent`, **no cookies and no `Origin`**. The clinic side (register patient,
`portal_access` consent, invitation) went through the staff API as reception would. 36 of 36 checks passed. One shortcut: no mail server ran, so
the verified-email precondition for two-step verification was set in the database.

| Area                   | Observed                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation and sign-in | Tokens come back in the JSON body (`tokenType: "Bearer"`, `expiresIn: 900`, refresh expiry 14 days); no `Set-Cookie`. `organizationCode` is required (400 without it).                                                                                                 |
| Reads                  | `/portal/me`, appointments, results, prescriptions, billing, messages and documents answer 200 with only `Authorization: Bearer`. No token → 401.                                                                                                                      |
| Audience separation    | A staff token is refused on `/portal/me` and a patient token on `/patients/:id` (401 both ways).                                                                                                                                                                       |
| CORS                   | An unknown `Origin` does not block the request (no `Access-Control-Allow-Origin` is sent); CORS only restricts browsers, so the API's authorization, not `CORS_ORIGINS`, protects it from other clients.                                                               |
| Refresh                | `{ refreshToken }` in the body rotates the token and **keeps the original expiry** (absolute session, not sliding). Reusing a rotated token → 401 `invalid_token` and the **whole session is revoked** (access and refresh tokens).                                    |
| Logout                 | `POST /portal/auth/logout` → 204; the access token is refused at once (sessions are checked per request) and the refresh token too.                                                                                                                                    |
| Sessions               | Each session stores the app's `User-Agent` and IP; there is no device name, device id or patient-facing list of sessions.                                                                                                                                              |
| Two-step verification  | Setup returns `secret` and an `otpauth://` URI; with it on, login answers `{ status: "mfa_required", challengeToken }`; the challenge is not a session token (401); `POST /portal/auth/mfa/verify` returns the normal token response; a code is refused a second time. |
| Guardian access        | `X-Acting-For` is a plain header, so a native client can use it; it is refused on own-account routes (`/portal/mfa`) and without a live grant (`proxy_not_allowed`). `/portal/proxy/dependents` works with a bearer.                                                   |
| Push                   | An Expo-style device token is refused by `POST /portal/push/subscriptions` (400) — it accepts Web Push subscriptions only.                                                                                                                                             |
| Rate limit             | Credential endpoints (activate, login, refresh, MFA verify, password reset) allow 10 requests a minute **per client IP** (`@Throttle`), then 429 `rate_limited`.                                                                                                       |

**Conclusion:** a native app can use the existing patient sign-in as it is; no second authentication system and no API change are needed for
sign-in, reads, refresh, logout or two-step verification. What the web portal's server does today, the app must do itself:

1. **Keep the refresh token in secure device storage** (not plain AsyncStorage) and the access token in memory.
2. **Refresh single-flight.** Two concurrent refreshes with the same token look like theft: the second is treated as reuse and signs the
   patient out everywhere on that session. The web portal already serialises refresh (`libs/web-session`); the app must too.
3. **Sign out only on 401.** Wrong passwords or codes during a sensitive change answer 422, deliberately, so the session survives
   ([portal-app.md](portal-app.md#email-verification)).
4. **Send `organizationCode`** (see D4).
5. **Send `X-Acting-For` only on routes that allow it**, as `apps/portal/src/lib/proxy-access.ts` does, if guardian access is in scope (D2).

Open points found by the trace, for the decisions below (not changes made):

- **Shared IP rate limit (INFERRED risk).** Phones reach the API directly, not through the portal server, so the throttle keys on the phone's
  public IP — which on mobile networks is often shared by many subscribers (carrier-grade NAT). Ten sign-ins or refreshes a minute per IP could
  then be exhausted by unrelated patients. Not measured; decide with D5 whether the limit needs a different key for app traffic.
- **Absolute session length.** A refresh never extends `refreshTokenExpiresAt`, so the app signs the patient out after
  `REFRESH_TOKEN_TTL_DAYS` (14) whatever their activity — part of D5.
- **Password reset** links open `PORTAL_BASE_URL/reset-password#token=…` in the browser (D7); the reset itself works from any client.

### Patient data endpoints (VERIFIED, [portal-app.md](portal-app.md#data))

`/api/v1/portal/*` already serves profile, visits, booking/reschedule/cancel, released results and trends, medicines, care plans,
teleconsultations, bills, messages and conversations, dental (when the organization opts in), documents and records requests, email and
two-step verification, notification settings and consents. Every read is audited with actor type `patient`, and the release rules (e.g. results
only when released, releasable and — if critical — acknowledged) are enforced in the API, not the client.

### Push (PARTIALLY VERIFIED)

Push exists as **Web Push** only: `POST /portal/push/subscriptions` takes a browser subscription (`endpoint` + `p256dh`/`auth` keys),
`WebPushSender` delivers content-free notices, up to 5 devices per account ([notification.md](../domains/notification.md#push-browsers-and-the-mobile-app)).
A native device token (Expo, FCM, APNs) cannot be registered through that contract; the app registers through
`POST /portal/push/mobile-devices` instead (migration `0081`, [§8](#8-push-to-the-app-provisional-d6)).

### Shared code (PARTIALLY VERIFIED)

| Library                   | Usable from React Native?                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@healthcare/web-session` | No — Next.js server session code (cookies, redirects).                                                                                                       |
| `@healthcare/ui`          | No — shadcn/ui + Tailwind web components. Design tokens may be reusable (not checked).                                                                       |
| `@healthcare/domain`      | Yes for `@healthcare/domain/portal-results` (plain TypeScript; used by the app). The package root also exports demo data — the app imports the subpath only. |
| API response types        | No contract library; the staff app mirrors types by hand (`apps/staff/src/lib/api/types.ts`).                                                                |
| Video                     | `VideoCall` (LiveKit) lives in `@healthcare/ui/healthcare` — web only.                                                                                       |

## 3. Constraints that already apply to any mobile client

These follow from existing project rules, not from new requirements:

- The app is a **client of `/api/v1/portal/*`**. No direct database access, no import of backend libraries, no business rules that the API
  already owns (release rules, booking rules, consent, billing figures) (`CLAUDE.md` §4, §40; module boundaries).
- **One patient identity and one MyHealth account** — the app signs in to the same `patient_portal_account`; it is never a second account
  system (`CLAUDE.md` §5, [portal-app.md](portal-app.md#patient-identity-and-accounts)).
- Notifications stay **content-free** ("a result is waiting", never what it says) and respect the patient's channel preferences
  ([notification.md](../domains/notification.md)).
- **No secrets in the app binary**; anything shipped in it is recoverable.
- No regulatory claim (Data Privacy Act, NPC) is made for the app; open items go to `docs/security/compliance-dependencies.md`.

## 4. Decisions needed before implementation

Record the answer (and who decided) here before building the part it governs.

**Recorded (2026-09-30):**

- **D1 — patients only** (product owner).
- **D2 — first release: sign-in and results** (product owner). Activation, password reset, visits, booking, medicines, bills, messages,
  documents, guardian access and everything else stay in MyHealth on the web for now.
- **D4, D5, D12 — provisional, accepted by the product owner (2026-09-30)** for the first slice; they follow existing conventions and stay open
  to revisit before a store release:
  - D4: one build per organization (`EXPO_PUBLIC_ORGANIZATION_CODE`), as one MyHealth web deployment serves one organization.
  - D5: the refresh token in the Keychain/Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: not in backups, not on another device), the access
    token in memory, the API's session length unchanged (14 days), no app lock or biometric unlock; nothing else about the patient is
    stored on the device.
  - D6 (added after D2, at the product owner's request to build push; confirm or change): push through the **Expo push service**; the
    app's Expo token is registered as one of the account's push devices (§8).
  - D12: result types and wording shared with MyHealth on the web through `@healthcare/domain/portal-results`; the few other response
    types mirrored by hand in `apps/mobile/src/lib/api-types.ts`, as the web apps do. No contract library yet.

Every other decision below is still **UNKNOWN**.

| #   | Decision                                                                                                                                                                                                                                                              | Why it matters                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| D1  | **Users.** Patients only (as `CLAUDE.md` §1 suggests), or also staff?                                                                                                                                                                                                 | Staff use a different auth system, permissions and API surface.                                                 |
| D2  | **First-release workflows.** Which of the MyHealth areas in §2 are in the first release? What, if anything, should the app do that MyHealth does not?                                                                                                                 | Every screen must map to an existing API capability or an approved requirement.                                 |
| D3  | **Why native over MyHealth on a phone?** MyHealth is already mobile-first and has browser push. What does the app add (e.g. native push, app-store presence)?                                                                                                         | Decides whether the app is worth its release and maintenance cost, and which features justify it.               |
| D4  | **Organizations.** One build per organization (fixed `organizationCode`, like a portal deployment) or one app where the patient picks or enters their clinic?                                                                                                         | Login needs `organizationCode`; affects sign-in UX and app-store listing.                                       |
| D5  | **Session on the device.** Token storage (e.g. Keychain/Keystore through a secure-storage module), session length on a phone (`REFRESH_TOKEN_TTL_DAYS` is shared with the web), app lock or biometric unlock (not requested anywhere today), sign-out on device loss. | Security posture; biometric unlock is not a requirement unless decided here.                                    |
| D6  | **Push.** Required? If so, which provider (Expo push, or FCM/APNs directly)? This needs a native device-token registration and a sender behind the existing `push` channel.                                                                                           | New API contract and possibly a migration; the provider is an open dependency in `dependencies.md`.             |
| D7  | **Links from email and push.** Should password-reset and notice links open the app (universal/app links) or keep opening the web portal?                                                                                                                              | Reset links are built from `PORTAL_BASE_URL` today; deep links need routes that map to existing workflows only. |
| D8  | **Teleconsultation.** In the app (LiveKit React Native SDK, camera and microphone permissions) or hand off to MyHealth in the browser?                                                                                                                                | Largest device-capability and dependency decision.                                                              |
| D9  | **Other device capabilities.** Camera or file upload (there is no patient document upload endpoint today), calendar, location — each needs a verified workflow.                                                                                                       | No permission is requested without one.                                                                         |
| D10 | **Offline and caching.** Is any patient data kept on the device (results, documents, bills)? If yes: what, for how long, encrypted how, and cleared when?                                                                                                             | `CLAUDE.md` §30 names staff offline workflows, not patient ones; health data should not be cached by default.   |
| D11 | **Screen protection.** Screenshot/app-switcher blurring, clipboard handling, crash-report scrubbing.                                                                                                                                                                  | PHI exposure on shared phones.                                                                                  |
| D12 | **Contracts.** Introduce a shared API contract library (response types + Zod schemas) for portal endpoints, or mirror types in the app as the staff app does?                                                                                                         | Avoids a third hand-kept copy of the portal types.                                                              |
| D13 | **Release.** App identifiers, store accounts, signing, build channels (development/staging/production), minimum OS versions, versioning and how the API stays compatible with old app versions.                                                                       | Store listing and API change policy (`/api/v1` changes can no longer be deployed in lockstep with the client).  |
| D14 | **Testing.** Which journeys must run through the app itself (e.g. sign-in with two-step verification, booking, results)?                                                                                                                                              | `CLAUDE.md` §31; the current e2e project covers the web apps only.                                              |

## 5. Suggested order once decided (recommendation, not a requirement)

1. ~~Record D1–D5 and D12.~~ D1, D2 recorded; D4, D5, D12 accepted as provisional; D3 open.
2. ~~Scaffold `apps/mobile` with sign-in and one read-only area from D2.~~ Done (§7).
3. Add the remaining D2 areas, then links (D7) if chosen, each with its own API change, documentation and tests. Push (D6) is built provisionally (§8).
4. Teleconsultation (D8) last, as it carries the most native dependencies.

## 6. Out of scope for this note

Staff mobile use, offline staff workflows (`CLAUDE.md` §30) and any regulatory assessment. Guardian and dependent access now exists in
MyHealth ([portal-app.md](portal-app.md#guardians-and-dependents)); whether the app offers it is part of D2.

## 7. First slice (`apps/mobile`)

Expo SDK 57 (React Native 0.86, React 19.2.3), expo-router, TypeScript strict. Nx project `mobile`, tags `scope:mobile`, `type:app`; it may
import only `type:domain` libraries (`eslint.config.mjs`), i.e. `@healthcare/domain/portal-results`, never backend or web-only code.

| Screen                           | API                                                                                                    | Notes                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Sign-in (`/sign-in`)             | `POST /portal/auth/login`, `POST /portal/auth/mfa/verify`                                              | Password, then the authenticator or recovery code when the account uses two-step verification. Errors worded as on the web. |
| Your results (`/`)               | `GET /portal/me` (clinic time zone), `GET /portal/results`                                             | Latest result per test, same wording as MyHealth (icon + words + colour). Pull to refresh.                                  |
| Result history (`/results/[id]`) | `GET /portal/results/trend?testId=`                                                                    | Every visible value with the range it had at the time. No chart yet.                                                        |
| Notifications (`/notifications`) | `GET /portal/push`, `POST /portal/push/mobile-devices`, `/push/test`, `/push/subscriptions/:id/remove` | Turn push on or off for this phone, send a test, remove other devices (§8).                                                 |
| Sign out (header)                | `POST /portal/auth/logout`                                                                             | Unregisters this phone from push (best effort), ends the session at the API (best effort) and clears the device.            |

**Session** (`src/lib/session.ts`, platform-neutral): access token in memory, refresh token in `expo-secure-store`; refreshes 30 s before
expiry and **single-flight** (a second use of a rotated token would revoke the session); retries a request once after a 401; signs the patient
out only when the API refuses the session — a 422, 403, 429, server error or no network keeps it; never sends `X-Acting-For`.

**Configuration** (build time, readable in the binary — not secrets): `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_ORGANIZATION_CODE`
(`apps/mobile/.env.example`). Without them the app says it is not set up.

**Verified (2026-09-30):**

- Unit tests (Vitest, `pnpm nx test mobile`): the session rules against a fake API that rotates tokens and revokes on reuse — the
  single-flight test fails when the guard is removed.
- The app's session code against a running API with a real laboratory workflow (external order → specimen → results → verify → approve →
  release): wrong password wording, sign-in, profile time zone, only releasable results, history, three concurrent requests after expiry on
  one refresh, restart from the stored token, and a clinic disabling access ending the session on the device.
- Metro bundles for iOS and Android (`expo export`), and every SDK-managed package at the version Expo SDK 57 names.
- The screens rendered through React Native for Web in Chromium against the same API (sign-in with an error, results, history, sign-out),
  as a stand-in: **not yet run on an iOS or Android device or simulator.**

**Not built (each needs its decision):** activation and password reset in the app (D7), deep links (D7), charts and printable
reports, guardian access (D2), Expo push receipts (§8), screen protection (D11), offline caching (D10), store builds and signing (D13), end-to-end journeys through the
app (D14). The shared-IP rate limit (§2) is unchanged.

## 8. Push to the app (provisional D6)

The platform sends to phones through the **Expo push service** (`https://exp.host/--/api/v2/push/send`; `ExpoPushTransport` in
`libs/notification`), which relays to Apple (APNs) and Google (FCM). Sending needs no account; `EXPO_PUSH_ENABLED=true` on the API and the
notification worker turns it on (`EXPO_ACCESS_TOKEN` only if the Expo project uses "enhanced push security"). Without it the app says the
clinic has not turned notifications on.

- **One device table.** The app's Expo token is a `push_subscription` row with `kind = 'expo'` (migration `0081`; the token is the `endpoint`,
  there are no browser keys, `device_label` names the phone). The per-account limit of 5 devices (browsers included), removal, the
  "notification settings" device count, failure counting and the patient's preferences are the same as for browsers. A token registered by
  another account moves to that account.
- **One sender.** `WebPushSender` delivers a `push` notification to every active device of the account — browsers through Web Push, phones
  through Expo — for whichever the platform has set up. A ticket of `DeviceNotRegistered` drops the device; a service failure is retried; a
  refusal counts toward the 5-failure limit.
- **Content.** Exactly what a browser push carries: a title, one line and a page (`data.url`) — never a result, a name or a reason. The
  "push first" rule applies (`apps/api/src/app/portal/patient-push.ts`): with the app turned on, results-ready, records, dental and
  message-waiting notices go there instead of SMS or email.
- **In the app** (`src/lib/push.ts`, platform-neutral and unit-tested; `src/lib/native-push.ts` for `expo-notifications`): the Notifications
  screen asks the phone's permission only when the patient turns notifications on, registers the token, sends a test, turns it off or removes
  another device. Tapping a results notice opens the results list; other notices open the app. Signing out unregisters the phone first
  (best effort) — a device the API can no longer reach is dropped by the failure rules. `PatientSession.post` has the same refresh and
  sign-out rules as `get`.
- **Build.** Receiving push needs the app linked to an Expo project (`eas init`, which writes `extra.eas.projectId` to `app.json`), a
  development or store build through EAS, an Apple Developer account and, for Android, the organization's own Firebase credentials uploaded
  to the Expo project. Expo Go on Android cannot receive remote push.
- **Tests.** App: `src/lib/push.test.ts` (permission, registration, refusals, sign-out) and the session's POST tests. API:
  `apps/api/test/portal-push-mobile.int.spec.ts` (registration, limits, the database constraint, sending, gone tokens, retries). **Not yet run
  on a device.**
- **Not built:** Expo push _receipts_ (Expo reports some failures, notably an uninstalled app, only in receipts fetched later; until then such a
  device stays registered and is dropped after 5 failed sends or removed by the patient), badges, deep links into other screens.
