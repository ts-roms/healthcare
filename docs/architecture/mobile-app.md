# MyHealth mobile app (`apps/mobile`)

**Status:** a first, notifications-only release is built (below). The product decisions listed in
[Decisions still to record](#decisions-still-to-record) are **not yet recorded**; the build takes a position on each so it can be reviewed,
and any of them may still change. This page began as a requirements note (evidence labels: **VERIFIED**, read in the repository;
**UNKNOWN**, needs a decision); its findings are kept below.

An Expo (React Native) app for **patients**, tagged `scope:mobile`, `type:app`. It is a client of the same `/api/v1/portal/*` API as the web MyHealth
(`apps/portal`); it has no server of its own and shares no code with the Next.js apps (their session code is server-side). Version 1 is a
**notifications app**: it signs the patient in, receives push notifications, lists the patient's notices and manages the devices that receive
them. Visits, results, bills and the rest stay on the web MyHealth, which the app links to.

## What it does

- **Sign in** with the MyHealth email and password, and the code from an authenticator app when the account uses two-step verification
  (`POST /portal/auth/login`, `/portal/auth/mfa/verify`). First-time activation and password reset stay on the web MyHealth.
- **Notices** (`GET /portal/messages`, `POST /portal/messages/:id/read`): the patient's MyHealth notices, newest first, in the clinic's time
  zone, pull to refresh, refreshed when a push arrives.
- **Notifications on this phone** (`/settings`): asks the phone's permission, registers the phone (`POST /portal/push/mobile-devices`), sends a
  test notice, turns notifications off on this phone or removes another device (up to 5 devices, browsers included).
- **A tapped notification** opens the app and, when it names a page of the web MyHealth, offers **Open in MyHealth**. Only plain relative paths
  are ever followed (`lib/links.ts`); a notification cannot send the patient to another site.
- **Sign out** removes this phone's registration first (best effort), ends the session on the server and clears it here.

## Push

The platform sends to phones through the **Expo push service** (`https://exp.host/--/api/v2/push/send`; `ExpoPushTransport` in
`libs/notification`), which relays to Apple (APNs) and Google (FCM). Sending needs no account; `EXPO_PUSH_ENABLED=true` turns it on
(`EXPO_ACCESS_TOKEN` only if the Expo project uses "enhanced push security"). Without it the app is told push is not offered.

- **One device table.** The app's Expo token is a `push_subscription` row with `kind = 'expo'` (migration `0081`; the token is the
  `endpoint`, there are no browser keys, `device_label` names the phone). The per-account limit of 5 devices, removal, the "notification
  settings" device count, failure counting and the preference rules are the same as for browsers. A token registered by another account moves
  to that account.
- **One sender.** `WebPushSender` delivers a `push` notification to every active device of the account, browsers through Web Push and phones
  through Expo, for whichever the platform has set up. A ticket of `DeviceNotRegistered` drops the device; a service failure is retried; a
  refusal counts toward the 5-failure limit.
- **Content.** Exactly what a browser push carries: a title, one line and a page (`data.url`) — never a result, a name or a reason. The
  same "push first" rule applies (`patient-push.ts`), so a patient with the app gets results-ready, records, dental and message-waiting
  notices there instead of by SMS or email.
- **Not built:** Expo push _receipts_ (Expo reports some failures, notably an uninstalled app, only in receipts fetched later; until then such a
  device stays registered and is dropped after 5 failed sends or removed by the patient), badges and per-notice deep links inside the app.

## Security

- The session (access and refresh token) is kept in the phone's Keychain / Keystore (`expo-secure-store`, this device only, while unlocked),
  never in plain storage. The refresh token rotates; requests that fail together share one refresh (`lib/api.ts`). A refresh the API refuses
  ends the session; being offline does not.
- The API address must be `https://` in release builds (`lib/config.ts`); `http://` is allowed only in development builds.
- The app holds no secret. Its organization, API address and web MyHealth address are public build settings.
- Everything the app can do is what the patient can do in the web MyHealth; the API authorizes every call, re-checking session, account and
  portal consent (`PatientAccessGuard`), and audits it (actor type `patient`). Guardian access (`X-Acting-For`) is not offered in the app yet.

## Build and run

One build serves one organization. Set at build time (public values, inlined by Metro):

| Variable                        | Meaning                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`      | The API, including the version prefix, e.g. `https://api.example.ph/api/v1`  |
| `EXPO_PUBLIC_ORGANIZATION_CODE` | The organization's code (`organization.code`), as the web MyHealth uses      |
| `EXPO_PUBLIC_PORTAL_URL`        | Optional: the web MyHealth's address, for the "open in MyHealth" links       |
| `EAS_PROJECT_ID`                | The Expo project the push token belongs to (needed to receive notifications) |
| `MYHEALTH_IOS_BUNDLE_ID`        | The organization's own iOS bundle id (defaults to a placeholder)             |
| `MYHEALTH_ANDROID_PACKAGE`      | The organization's own Android application id (defaults to a placeholder)    |
| `MYHEALTH_APP_NAME`             | The name shown under the icon (default "MyHealth")                           |

```bash
pnpm dev:mobile        # Expo dev server; open in Expo Go or a development build
pnpm nx test mobile    # unit tests of src/lib (sign-in, refresh, push flow, links, times)
```

Push on a real phone needs a development or store build made through EAS (`eas build`), an Apple Developer account and, for Android,
the organization's own Firebase project (its FCM credentials uploaded to the Expo project). Expo Go on Android cannot receive remote push.
The app icon, splash image and store listings are the organization's own and are not in the repository. Publishing to the App Store or Google
Play, and the store's privacy declarations, are the organization's to complete (see `docs/security/compliance-dependencies.md`).

## Tests

`src/lib` holds all the logic that is not screen layout and is tested with Vitest without a React Native runtime: the API client (token
refresh, single flight, offline, sign-out), the push flow (permission, registration, refusals, sign-out), settings validation, links,
time formatting. Screens are type-checked and bundled (`expo export`) but have no UI tests. The API side is covered by
`apps/api/test/portal-push-mobile.int.spec.ts` (registration, limits, the database constraint, sending, gone tokens, retries).

## Findings from the requirements note

### Native client trace of the auth contract (VERIFIED, 2026-09-30)

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

The trace found that `POST /portal/push/subscriptions` refuses an Expo token; the app now registers through
`POST /portal/push/mobile-devices` instead (see [Push](#push)).

### Constraints that apply to any mobile client

These follow from existing project rules, not from new requirements:

- The app is a **client of `/api/v1/portal/*`**. No direct database access, no import of backend libraries, no business rules that the API
  already owns (release rules, booking rules, consent, billing figures) (`CLAUDE.md` §4, §40; module boundaries).
- **One patient identity and one MyHealth account** — the app signs in to the same `patient_portal_account`; it is never a second account
  system (`CLAUDE.md` §5, [portal-app.md](portal-app.md#patient-identity-and-accounts)).
- Notifications stay **content-free** ("a result is waiting", never what it says) and respect the patient's channel preferences
  ([notification.md](../domains/notification.md)).
- **No secrets in the app binary**; anything shipped in it is recoverable.
- No regulatory claim (Data Privacy Act, NPC) is made for the app; open items go to `docs/security/compliance-dependencies.md`.

## Decisions still to record

Each item remains **UNKNOWN** until product records the answer (and who decided) here. The first release was built ahead of these
decisions; the last column says what it does, so each choice can be confirmed or changed. None of them is a recorded decision.

| #   | Decision                                                                                                                                                                                                                                                              | Why it matters                                                                                                  | As built on this branch (proposal, not a recorded decision)                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Users.** Patients only (as `CLAUDE.md` §1 suggests), or also staff?                                                                                                                                                                                                 | Staff use a different auth system, permissions and API surface.                                                 | Patients only.                                                                                                                                                                                                                      |
| D2  | **First-release workflows.** Which of the MyHealth areas in §2 are in the first release? What, if anything, should the app do that MyHealth does not?                                                                                                                 | Every screen must map to an existing API capability or an approved requirement.                                 | Notifications only: sign-in (with two-step verification), notices, and device management. Everything else links to the web MyHealth; guardian access is not offered.                                                                |
| D3  | **Why native over MyHealth on a phone?** MyHealth is already mobile-first and has browser push. What does the app add (e.g. native push, app-store presence)?                                                                                                         | Decides whether the app is worth its release and maintenance cost, and which features justify it.               | Native push and an app-store presence; the web MyHealth keeps browser push.                                                                                                                                                         |
| D4  | **Organizations.** One build per organization (fixed `organizationCode`, like a portal deployment) or one app where the patient picks or enters their clinic?                                                                                                         | Login needs `organizationCode`; affects sign-in UX and app-store listing.                                       | One build per organization (`EXPO_PUBLIC_ORGANIZATION_CODE`).                                                                                                                                                                       |
| D5  | **Session on the device.** Token storage (e.g. Keychain/Keystore through a secure-storage module), session length on a phone (`REFRESH_TOKEN_TTL_DAYS` is shared with the web), app lock or biometric unlock (not requested anywhere today), sign-out on device loss. | Security posture; biometric unlock is not a requirement unless decided here.                                    | Both tokens in Keychain/Keystore (`expo-secure-store`, this device only, while unlocked); single-flight refresh; sign out only when the API refuses the refresh; session length unchanged (14 days, absolute); no biometric unlock. |
| D6  | **Push.** Required? If so, which provider (Expo push, or FCM/APNs directly)? This needs a native device-token registration and a sender behind the existing `push` channel.                                                                                           | New API contract and possibly a migration; the provider is an open dependency in `dependencies.md`.             | Expo push service (`ExpoPushTransport`, `EXPO_PUSH_ENABLED`); new `POST /portal/push/mobile-devices` and migration `0081`.                                                                                                          |
| D7  | **Links from email and push.** Should password-reset and notice links open the app (universal/app links) or keep opening the web portal?                                                                                                                              | Reset links are built from `PORTAL_BASE_URL` today; deep links need routes that map to existing workflows only. | Links keep opening the web MyHealth (`EXPO_PUBLIC_PORTAL_URL`); no universal/app links.                                                                                                                                             |
| D8  | **Teleconsultation.** In the app (LiveKit React Native SDK, camera and microphone permissions) or hand off to MyHealth in the browser?                                                                                                                                | Largest device-capability and dependency decision.                                                              | Not in the app.                                                                                                                                                                                                                     |
| D9  | **Other device capabilities.** Camera or file upload (there is no patient document upload endpoint today), calendar, location — each needs a verified workflow.                                                                                                       | No permission is requested without one.                                                                         | No other device capability; notification permission only.                                                                                                                                                                           |
| D10 | **Offline and caching.** Is any patient data kept on the device (results, documents, bills)? If yes: what, for how long, encrypted how, and cleared when?                                                                                                             | `CLAUDE.md` §30 names staff offline workflows, not patient ones; health data should not be cached by default.   | Nothing is cached on the device except the session.                                                                                                                                                                                 |
| D11 | **Screen protection.** Screenshot/app-switcher blurring, clipboard handling, crash-report scrubbing.                                                                                                                                                                  | PHI exposure on shared phones.                                                                                  | Not built.                                                                                                                                                                                                                          |
| D12 | **Contracts.** Introduce a shared API contract library (response types + Zod schemas) for portal endpoints, or mirror types in the app as the staff app does?                                                                                                         | Avoids a third hand-kept copy of the portal types.                                                              | Types mirrored in the app (`src/lib/types.ts`), as the staff app does.                                                                                                                                                              |
| D13 | **Release.** App identifiers, store accounts, signing, build channels (development/staging/production), minimum OS versions, versioning and how the API stays compatible with old app versions.                                                                       | Store listing and API change policy (`/api/v1` changes can no longer be deployed in lockstep with the client).  | Identifiers from build variables (placeholders by default); store accounts, signing, channels and version policy are not set.                                                                                                       |
| D14 | **Testing.** Which journeys must run through the app itself (e.g. sign-in with two-step verification, booking, results)?                                                                                                                                              | `CLAUDE.md` §31; the current e2e project covers the web apps only.                                              | Unit tests of `src/lib` and API integration tests; no device journeys.                                                                                                                                                              |

Staff mobile use, offline staff workflows (`CLAUDE.md` §30) and any regulatory assessment are out of scope.
