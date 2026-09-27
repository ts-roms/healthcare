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
| Home, Visits                  | `GET /portal/appointments` (upcoming and the past year; clinic time zone)                  |
| Results, result detail        | `GET /portal/results`, `GET /portal/results/trend?testId=`                                 |
| Medicines                     | `GET /portal/prescriptions` (active)                                                       |
| Care plan                     | `GET /portal/care-plans` (active plans: goals, what you can do, what is coming up)         |
| Online consultation           | `GET/PUT/POST /portal/teleconsults/*` (questionnaire, waiting room, video)                 |
| Messages                      | Not available yet ("coming soon")                                                          |

The records endpoints are composed in the API (`apps/api/src/app/portal/portal-records.controller.ts`) from the domains' patient-facing queries, behind `PatientAccessGuard`; every read is audited with actor type `patient` (`portal.appointments-view`, `portal.results-view`, `portal.results-trend`, `portal.prescriptions-view`, `portal.care-plans-view`). They return only what is meant for the patient: no staff names other than the practitioner, no internal comments, instruments, allergy override reasons or progress notes.

**Results (CLAUDE.md §17).** A result is shown only when it is the current version, **released**, of a test the laboratory marks as releasable to patients (`lab_test.patient_releasable`), and — if critical — after the ordering side has **acknowledged** it, so the patient never learns of a critical value before their care team. While a released result is being corrected it is hidden until the corrected version is released. The portal words each value against the snapshotted range in plain language ("Within the usual range", "Higher than the usual range", "Much higher than the usual range — your care team has been told"; icon, words and colour), shows "Usual range: …", and the result page draws a trend with the range shaded plus the history with each value's range at the time. It does not interpret results; it tells the patient to talk to their doctor (`lib/records.ts`).

**Results-ready notice.** When results of an order become visible to a patient who can use the portal (active account and `portal_access` consent), the API (`apps/api/src/app/portal/patient-result-notices.ts`) sends one SMS per order per day — or an email if SMS is not possible (no mobile, opted out) — using `lab.results-available`, which names no test or value. A correction of a visible result sends an "updated" notice. Communication preferences apply (category `clinical`). Production SMS still needs a provider (see `docs/domains/notification.md`).

**Online consultations.** Upcoming online visits in Visits and Home open `/consultations/[appointmentId]`, which walks the patient through: the pre-consult questions (reason, symptoms, medicines, new allergies, red flags, where they are, a callback number, and the acknowledgement of an online consultation's limits) — ticking a red flag shows "This may be an emergency: call 911 or go to the nearest emergency room" at once; the waiting room (from 30 minutes before; the page refreshes every 5 s until the doctor starts); **Join the video call** (`VideoCall`; camera and microphone permission; the call is not recorded) — or "your doctor will call you" without video; then the doctor's instructions, or the recommendation to be seen in person. Stage logic: `lib/teleconsult.ts`.

Patients cannot edit their record; Profile tells them to ask the clinic.

## Configuration

| Variable                   | Default                        | Meaning                                                   |
| -------------------------- | ------------------------------ | --------------------------------------------------------- |
| `API_BASE_URL`             | `http://localhost:3333/api/v1` | Where the portal's server reaches the API                 |
| `PORTAL_ORGANIZATION_CODE` | `demo`                         | The organization this portal serves (`organization.code`) |

## Not yet

Password reset (today: ask the clinic for a new code), email verification, MFA for patients, proxy access for guardians and dependents, online booking (Phase 4b), messages and reminders (Phase 4c).
