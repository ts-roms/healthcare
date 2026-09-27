# Patient portal ↔ API

`apps/portal` (MyHealth) is a mobile-first Next.js **backend-for-frontend**, built the same way as the staff app ([staff-app.md](staff-app.md)): the browser talks only to the portal's server, tokens live in httpOnly cookies, and the API authorizes every call. Session code is shared through `libs/web-session`.

```
browser ──cookies──▶ portal server (proxy.ts, server components, server actions)
                        │  Authorization: Bearer <patient access token>
                        ▼
                     API /api/v1/portal/*  ──▶ PatientAccessGuard, audit (actor type "patient")
```

## Patient identity and accounts

A portal account belongs to **one canonical patient** (`patient_portal_account`, unique per organization and patient); there is no second patient record. Patients are separate from staff users: separate tables, sessions (`patient_portal_session`), JWT audience (`healthcare-portal`) and guard. A staff token is rejected by portal endpoints and a patient token by staff endpoints.

| Step     | Who     | How                                                                                                                                                                                                                                                                                   |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent  | Staff   | Record `portal_access` consent (granted) on the patient. Without it no invitation, sign-in or refresh is allowed; withdrawing it ends portal sessions at their next request.                                                                                                          |
| Invite   | Staff   | `POST /patients/:id/portal-account/invitations` (`patient.portal.manage`) after checking the patient's identity in person. Returns a one-time code (`XXXXX-XXXXX`) **once**; only its SHA-256 is stored. Valid 72 hours, 5 wrong attempts. Issuing a new code replaces an unused one. |
| Activate | Patient | `/activate`: patient number + date of birth + code, then email and password (≥ 12 characters). All wrong details give the same message. The code is single-use.                                                                                                                       |
| Sign in  | Patient | `/login`: email + password, per portal deployment's organization. Repeated failures lock the account temporarily.                                                                                                                                                                     |
| Disable  | Staff   | `POST /patients/:id/portal-account/disable` with a reason; revokes every portal session. A new invitation re-enables access.                                                                                                                                                          |

Every step is audited: staff actions as `patient.portal-invite` and `patient.portal-disable`; patient actions (`portal.activate`, `portal.login`, `portal.logout`, `portal.profile-view`) with actor type `patient`, including failures; refresh-token reuse as `portal.session-revoke`.

## Session

| Cookie  | Holds         | Flags                                     | Lifetime                                |
| ------- | ------------- | ----------------------------------------- | --------------------------------------- |
| `hp_at` | Access token  | httpOnly, SameSite=Lax, Secure in prod    | Token TTL minus 30 s                    |
| `hp_rt` | Refresh token | httpOnly, SameSite=Strict, Secure in prod | Until the API's `refreshTokenExpiresAt` |

Names differ from the staff app's (`hc_*`) so the two sessions never mix on one domain. `src/proxy.ts` gates every page except `/login` and `/activate`, refreshes through `POST /portal/auth/refresh` with the same single-flight refresher and failure handling as the staff app (rejected → sign in; busy → 503 retry page), and clears stale cookies when the API ends a session (`/login?reason=session`). The API revokes the session if a rotated refresh token is reused.

## Data

| Area                          | Source                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Sign-in, activation, sign-out | API `/portal/auth/*`                                                                       |
| Greeting, Profile             | API `GET /portal/me` (identity only: name, patient number, birth date, sex, clinic, email) |
| Visits, results, messages     | Not available to patients yet — honest empty states; no fixture data                       |

Results will only ever list what has been **released for patient access** (CLAUDE.md §17). Patients cannot edit their record; Profile tells them to ask the clinic.

## Configuration

| Variable                   | Default                        | Meaning                                                   |
| -------------------------- | ------------------------------ | --------------------------------------------------------- |
| `API_BASE_URL`             | `http://localhost:3333/api/v1` | Where the portal's server reaches the API                 |
| `PORTAL_ORGANIZATION_CODE` | `demo`                         | The organization this portal serves (`organization.code`) |

## Not yet

Password reset (today: ask the clinic for a new code), email verification, MFA for patients, proxy access for guardians and dependents, and patient-facing appointments, results and messages.
