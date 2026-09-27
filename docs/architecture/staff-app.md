# Staff app ↔ API

`apps/staff` is a Next.js **backend-for-frontend**: the browser talks only to the staff app's server, which calls the API (`apps/api`). Access and refresh tokens never reach browser JavaScript. The session code shared with the patient portal (cookies, refresh, error mapping, forwarding, safe redirects) lives in `libs/web-session`.

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
- **Single-flight refresh** (`createRefresher` in `libs/web-session`, wired in `lib/api/tokens.ts`): the API rotates refresh tokens and **revokes the session when a rotated token is reused**. Parallel requests from one browser can all carry the same expired token, so concurrent refreshes of one token share a single API call, and the result is reused for 30 s. This is per process: running several staff-app instances needs sticky sessions or a shared store (e.g. Redis) for the same guarantee.
- **Refresh failures:** only a definitive rejection (invalid, expired or revoked token) signs the user out. A rate limit (429), server error or network failure returns a 503 "service is busy" page that retries itself, and the session cookies are kept.
- **Client identity** (`forwardedHeaders` in `libs/web-session`): every call to the API forwards the browser's IP (`X-Forwarded-For`, right-most entry as seen by the staff app) and user agent, so the API's per-client rate limits and the audit trail see the real client rather than the staff server. The API must run with `TRUST_PROXY=true` and **must not be reachable directly** (only through the staff app or a trusted proxy), otherwise clients could spoof the header.
- **API calls** (`lib/api/client.ts`, server-only): send the bearer token and `X-Facility-Id`; a `401` (session revoked or expired) redirects to `/login?reason=session`, where the proxy clears the stale cookies; other errors become `ApiError` with the API's `code`, `message`, `details` and `requestId`.
- **Sign-out**: `POST /auth/logout` (revokes the session), then cookies are cleared.

Authorization is always the API's: the staff app hides what the user can't do (navigation from `GET /auth/me` permissions, buttons via `can()`), but every request is checked server-side by the API.

## Data

| Area                                                                                                                                                         | Source                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Sign-in, navigation, facility, patient lookup, patient record, clinical summary, portal access, registration, queue, triage/vitals, appointments, encounters | API                                                        |
| Laboratory, dental, telemedicine, dashboard clinical panels, `/preview/patient-360`                                                                          | `lib/demo-data.ts` fixtures, badged **Demo** with a banner |

Real patient pages show only API data: allergies and the clinical summary come from `GET /patients/:id/summary` (users without clinical access see "Allergies: no access"). Fixture clinical data is never shown next to a real patient.

**Consent & communication** shows the latest decision per consent type (granted, expired, refused, withdrawn; from the patient detail). Users with `patient.consent.manage` can **Record consent**: type, decision, how it was given (paper, electronic, verbal), an optional end date (end of that day in Manila) and notes, posted to `POST /patients/:id/consents` (append-only, audited; takes effect when recorded). The full history (`GET /patients/:id/consents`) is loaded only when staff choose "Show consent history", because every read of it is audited. Form rules live in `lib/consent-form.ts`.

**Signed consent forms:** users who also have `document.upload` can attach the signed form (PDF, JPEG, PNG or HEIC, ≤ 10 MB) when recording a consent. The file goes to the staff app's server in the server action (`experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize` are raised to 12 MB in `next.config.ts`), which registers a `consent_form` document for the patient (`POST /documents` with an idempotency key), PUTs the bytes to the presigned URL, calls `/documents/:id/complete`, and then records the consent with that `documentId` (`lib/api/documents.ts`). The browser never talks to object storage for uploads, so the bucket needs no CORS rules; the staff server must be able to reach the storage endpoint. If the upload succeeds but the consent is rejected, the form keeps the document id and a retry links it instead of uploading again. Users with `document.read` see a **Signed form** link, which opens a 5-minute signed URL (each one audited as `document.download`).

The record also has a **Patient portal (MyHealth)** card (`GET /patients/:id/portal-account`): status for anyone who can read the patient, and for `patient.portal.manage` an invite button that shows the one-time activation code once, and "Disable access" with a reason. See [portal-app.md](portal-app.md).

Response types are mirrored in `lib/api/types.ts` because `layer:ui` projects may not import backend libraries. Move them into `type:contract` libraries, or generate them from the OpenAPI document, as domains grow.

## Queue and appointments

Front-desk flow: find the patient → **Check in (walk-in)** or **Book appointment** on the patient record → the queue board or day schedule.
Nurse flow: queue board → select a ticket → **Triage & vitals** (`/queue/visits/[id]/triage`) → "Complete triage" moves the patient to _Ready for provider_ ("Save, keep in triage" leaves them in triage).

- **Facility-scoped.** `/queue`, `/queue/walk-in`, `/appointments` and `/appointments/new` need a facility selected in the top bar (the queue, check-in and schedule belong to a facility; the day and its time zone come from the facility).
- **Server actions** (`app/(staff)/queue/actions.ts`, `app/(staff)/appointments/actions.ts`) call the API and return `{ ok, data } | { ok: false, message, code }` (`lib/api/action-result.ts`), so forms show API errors instead of crashing. Walk-ins and bookings send an `Idempotency-Key` per attempt.
- **Optimistic locking.** Every move, call, confirm, cancel and no-show sends the row's `version`. A `409 version_conflict` (someone else acted first) shows a message and refreshes the screen.
- **Rules stay in the API.** `lib/clinic-mapping.ts` maps API rows to the design system's `QueueBoard` and `AppointmentCard` and decides which buttons to offer by mirroring `libs/clinic` (queue transitions; check-in only on the appointment's day; no-show only after the start time). The API enforces the rules either way.
- **Minimal identification.** Queue and schedule rows carry only a patient brief (number, display name, sex, age), not contacts or clinical details. Listing a schedule is audited (`appointment.list`).
- **Triage** (`POST /queue/visits/:id/triage`, `clinic.triage.write`) records the assessment and optional vital signs in one API transaction. The page shows the allergy banner and previous vitals (needs `clinical.read`), as the clinic rules require allergies to be visible at triage. `lib/triage-form.ts` mirrors the API's plausibility limits so typos are caught before submitting (they are data-entry guards, not clinical reference ranges); the API re-checks and its `implausible_vital_signs` details are shown on the fields. Values are never auto-corrected. BMI is shown for display only.
- **Refresh.** The queue page re-renders from the server every 15 s while visible (`router.refresh()`). The API's Socket.IO `/realtime` gateway needs an access token, which the staff app keeps server-side; connecting browsers to it needs a short-lived socket ticket endpoint (follow-up).

## Allergies

`components/allergies-panel.tsx` shows the patient's active allergies (most dangerous first) and, with `allergy.manage`, records them wherever they are asked about: the patient record, triage and the encounter workspace.

- **Record allergy**: substance, category, reaction, severity, criticality, verification (`POST /patients/:id/allergies`; an active duplicate is refused with `allergy_exists`).
- Allergies are never edited or deleted: **Resolved…**, **No longer relevant…** and **Entered in error…** change the status with a reason and the row's `version`. A wrong entry is marked entered in error and recorded again.
- **Patient reports no known allergies** records a review (`POST /patients/:id/allergy-reviews`) and is offered only when nothing active is recorded; **Reviewed with patient** records a review when allergies exist. "Not reviewed" is never shown as "no allergies", and an older "no known allergies" does not survive a later allergy change (API rule).
- New allergies appear immediately in the banner and in the prescription dialog, and the API's drug–allergy check uses them.

## Encounter workspace

Doctor flow: queue board or **Consultations** (`/clinic/encounters`) → **Start consultation** (`POST /encounters` with the visit; the visit moves to _with provider_) → workspace (`/clinic/encounters/[id]`) → **Sign encounter** (the visit and appointment complete).

- **Three panes** (`DoctorLayout`): the patient's encounters · the current note, diagnoses and this visit's triage and vitals · clinical context from `GET /patients/:id/summary` (allergies, problems, active prescriptions, care plans, latest vitals). Below 1280 px the panes become tabs.
- **Notes are append-only revisions.** "Save draft" (Ctrl/Cmd+S) sends `basedOnRevision`; if someone saved a newer revision the API answers `409 note_revision_conflict`, and the workspace keeps the clinician's text, shows the latest saved version beside it and lets them choose (nothing is overwritten silently). Leaving with unsaved text asks for confirmation.
- **Signing** is offered to the responsible practitioner (their account is linked to the encounter's practitioner) with `encounter.sign`; unsaved text is saved as a draft first, so what is signed is what is on screen. The API refuses a note without an assessment or plan, and anyone but the responsible practitioner.
- **After signing** the note is read-only; **Amend note** (`encounter.amend`) adds an amendment with a reason, and adding or correcting a diagnosis also needs a reason. The **revision history** shows every draft, the signed version and amendments (viewing it is audited).
- **Opened in error** (wrong patient, duplicate) marks the encounter entered in error with a reason; it stays for audit and the patient returns to _ready for provider_.
- `lib/encounter-mapping.ts` decides which controls to offer by mirroring `libs/clinic`; the API enforces every rule. Queue rows carry `encounterId`, so the board and the consultations list open the right encounter.
- **Prescribing** (`prescription.issue`, the user linked to a physician or dentist): **New prescription** (Alt+P) opens a form of structured lines (generic name, strength, form, dose, route, frequency, duration, quantity, refills, patient instructions) with the patient's recorded allergies at the top. `lib/prescription-form.ts` mirrors the API's validation so errors show per field. Issuing sends an `Idempotency-Key` per attempt.
- **Drug–allergy decision support** is the API's (`libs/prescription/src/lib/allergy-check.ts`): a `409 allergy_warning` lists each medicine that matches a recorded allergy by name. The form shows the warnings, states that the check is a name match without drug-class knowledge (no warning is not evidence of safety), and lets the prescriber change the medicine or override with a documented reason (≥ 10 characters). The override is stored with the prescription and audited. The staff app does not run its own allergy rule.
- Prescriptions are immutable: **Replace** (with a reason) supersedes an active prescription with a new one, also after signing; **Cancel** needs a reason. New prescriptions are issued only while the encounter is open.
- **Follow-up**: the action bar offers "Follow-up in 1 week / 2 weeks / 1 month / 3 months", opening the booking page with the patient, the encounter's practitioner, the date and `returnTo` (the encounter; same-origin paths only, via `safeNextPath`). After booking, the user returns to the encounter.
- **Care plans** (`care-plan.read` / `care-plan.manage`): the workspace lists the patient's open plans with their open activities (overdue ones flagged) and creates new plans from the encounter (`sourceEncounterId`), offering the encounter's active diagnoses as problems, with goals and activities (kind, assignee, due date, repeat interval, goal). **Book** on a planned follow-up activity opens the booking page with `carePlanId`/`activityId`; once booked, the staff app links the appointment and the activity becomes _scheduled_. **Done** on a recurring activity makes the API create the next occurrence. `/clinic/care-plans/[id]` shows the whole plan: goal status, all activities (add, complete, cancel with reason), progress notes and plan status (on hold / cancelled with a reason). `lib/care-plan-form.ts` mirrors `libs/care-plan` transitions for which buttons to offer.
- Lab orders, referrals and printing prescriptions are not in the workspace yet. The recall list (`GET /care-plans/activities/due`) has no screen yet: its rows carry patient ids only, so it needs a patient brief first.

## Configuration

`API_BASE_URL` (server-side, default `http://localhost:3333/api/v1`). The API's `CORS_ORIGINS` is irrelevant to the staff app's server-to-server calls but still lists the web origins for any direct browser use.
