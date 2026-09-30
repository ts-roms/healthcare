# Mobile app — requirements note (draft)

**Status: DRAFT — awaiting product decisions.** Nothing in this note is implemented, and nothing in it may be implemented until the decisions in
[§4](#4-decisions-needed-before-implementation) are recorded here. It separates what the repository already establishes from what still has to be
decided; it does not add requirements of its own.

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

Implication (INFERRED, not tested): a native client can call these endpoints directly with a bearer header and keep the refresh token itself —
no second authentication system is needed. It would have to store the refresh token securely on the device and send `organizationCode`, which
the web portal takes from `PORTAL_ORGANIZATION_CODE` per deployment.

### Patient data endpoints (VERIFIED, [portal-app.md](portal-app.md#data))

`/api/v1/portal/*` already serves profile, visits, booking/reschedule/cancel, released results and trends, medicines, care plans,
teleconsultations, bills, messages and conversations, dental (when the organization opts in), documents and records requests, email and
two-step verification, notification settings and consents. Every read is audited with actor type `patient`, and the release rules (e.g. results
only when released, releasable and — if critical — acknowledged) are enforced in the API, not the client.

### Push (PARTIALLY VERIFIED)

Push exists as **Web Push** only: `POST /portal/push/subscriptions` takes a browser subscription (`endpoint` + `p256dh`/`auth` keys),
`WebPushSender` delivers content-free notices, up to 5 devices per account ([notification.md](../domains/notification.md#push-web-push-to-patients-browsers)).
A native device token (Expo, FCM, APNs) cannot be registered through that contract.

### Shared code (PARTIALLY VERIFIED)

| Library                   | Usable from React Native?                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `@healthcare/web-session` | No — Next.js server session code (cookies, redirects).                                        |
| `@healthcare/ui`          | No — shadcn/ui + Tailwind web components. Design tokens may be reusable (not checked).        |
| `@healthcare/domain`      | Types possibly; also holds demo fixtures that must not reach a patient app. Not checked.      |
| API response types        | No contract library; the staff app mirrors types by hand (`apps/staff/src/lib/api/types.ts`). |
| Video                     | `VideoCall` (LiveKit) lives in `@healthcare/ui/healthcare` — web only.                        |

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

Each item is **UNKNOWN**. Record the answer (and who decided) in this section before building the part it governs.

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

1. Record D1–D5 and D12; confirm the auth contract from a native client against a development API (sign-in, MFA, refresh rotation, logout).
2. Scaffold `apps/mobile` (Expo, one navigation approach, `nx.tags`, own `eslint.config.mjs`) with sign-in and one read-only area from D2.
3. Add the remaining D2 areas, then push (D6) and links (D7) if chosen, each with its own API change, documentation and tests.
4. Teleconsultation (D8) last, as it carries the most native dependencies.

## 6. Out of scope for this note

Staff mobile use, offline staff workflows (`CLAUDE.md` §30), proxy access for guardians and dependents (listed under "Not yet" in
[portal-app.md](portal-app.md#not-yet)), and any regulatory assessment.
