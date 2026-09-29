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

- **Sign-in** (`app/(auth)/login/actions.ts`): `POST /auth/login` → tokens, or `mfa_required` (then `POST /auth/mfa/verify`), or `organization_selection_required` (the user picks an organization and re-enters the password). The facility selector lists `GET /auth/me/facilities` (active facilities where the user holds a role, every one for an organization-wide role; no `organization.read` needed); when that is exactly one facility it is selected at sign-in.
- **Public pages** (`PUBLIC_PATHS` in `src/proxy.ts`): only the landing page `/welcome` (`app/(public)/welcome`) renders without a session. It is static, never calls the API, and describes the platform from `components/platform-highlights.tsx`, which the split sign-in page (`app/(auth)/layout.tsx`) shares.
- **Gate and refresh** (`src/proxy.ts`): no refresh token → `/login?next=…` (same-origin paths only). No access token (its cookie expired) → `POST /auth/refresh`, and the new tokens go to both the current render and the browser.
- **Single-flight refresh** (`createRefresher` in `libs/web-session`, wired in `lib/api/tokens.ts`): the API rotates refresh tokens and **revokes the session when a rotated token is reused**. Parallel requests from one browser can all carry the same expired token, so concurrent refreshes of one token share a single API call, and the result is reused for 30 s. This is per process: running several staff-app instances needs sticky sessions or a shared store (e.g. Redis) for the same guarantee.
- **Refresh failures:** only a definitive rejection (invalid, expired or revoked token) signs the user out. A rate limit (429), server error or network failure returns a 503 "service is busy" page that retries itself, and the session cookies are kept.
- **Client identity** (`forwardedHeaders` in `libs/web-session`): every call to the API forwards the browser's IP (`X-Forwarded-For`, right-most entry as seen by the staff app) and user agent, so the API's per-client rate limits and the audit trail see the real client rather than the staff server. The API must run with `TRUST_PROXY=true` and **must not be reachable directly** (only through the staff app or a trusted proxy), otherwise clients could spoof the header.
- **API calls** (`lib/api/client.ts`, server-only): send the bearer token and `X-Facility-Id`; a `401` (session revoked or expired) redirects to `/login?reason=session`, where the proxy clears the stale cookies; other errors become `ApiError` with the API's `code`, `message`, `details` and `requestId`.
- **Sign-out**: `POST /auth/logout` (revokes the session), then cookies are cleared.

Authorization is always the API's: the staff app hides what the user can't do (navigation from `GET /auth/me` permissions, buttons via `can()`), but every request is checked server-side by the API.

## Help (user manual)

`/help` renders the user manual from `docs/manual/*.md` (the single source), read from the repository on the server by
`lib/manual-content.ts` (walks up from the working directory to `docs/manual`; cached per process), with the design system's
`Markdown` primitive. Links between chapters map to `/help/<slug>` (`lib/manual.ts`, the file name without its number);
links to developer documentation are shown as text. The menu shows **Help** to every signed-in user.

## Notifications

The top bar's bell shows the signed-in user's unread in-app messages (`GET /me/notifications/unread-count`, read by the
`(staff)` layout on each navigation; a failure shows no badge rather than an error). `/notifications` lists them with
**Open** (marks read and goes to the page the message links to, e.g. a nonconformance) and **Mark read**. Messages:
critical and corrected results to the ordering practitioner, laboratory quality notices to quality managers, staff
messages. See `docs/domains/notification.md`.

## Data

| Area                                                                                                                                                                                               | Source                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Sign-in, navigation, facility, patient lookup, patient record, clinical summary, patient timeline, portal access, registration, queue, triage/vitals, appointments, encounters, laboratory, dental | API                                                        |
| `/preview/patient-360` (including its dental tab)                                                                                                                                                  | `lib/demo-data.ts` fixtures, badged **Demo** with a banner |

Real patient pages show only API data: allergies and the clinical summary come from `GET /patients/:id/summary` (users without clinical access see "Allergies: no access"). Fixture clinical data is never shown next to a real patient.

**Consent & communication** shows the latest decision per consent type (granted, expired, refused, withdrawn; from the patient detail). Users with `patient.consent.manage` can **Record consent**: type, decision, how it was given (paper, electronic, verbal), an optional end date (end of that day in Manila) and notes, posted to `POST /patients/:id/consents` (append-only, audited; takes effect when recorded). The full history (`GET /patients/:id/consents`) is loaded only when staff choose "Show consent history", because every read of it is audited. Form rules live in `lib/consent-form.ts`.

**Signed consent forms:** users who also have `document.upload` can attach the signed form (PDF, JPEG, PNG or HEIC, ≤ 10 MB) when recording a consent. The file goes to the staff app's server in the server action (`experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize` are raised to 12 MB in `next.config.ts`), which registers a `consent_form` document for the patient (`POST /documents` with an idempotency key), PUTs the bytes to the presigned URL, calls `/documents/:id/complete`, and then records the consent with that `documentId` (`lib/api/documents.ts`). The browser never talks to object storage for uploads, so the bucket needs no CORS rules; the staff server must be able to reach the storage endpoint. If the upload succeeds but the consent is rejected, the form keeps the document id and a retry links it instead of uploading again. Users with `document.read` see a **Signed form** link, which opens a 5-minute signed URL (each one audited as `document.download`).

The record also has a **Patient portal (MyHealth)** card (`GET /patients/:id/portal-account`): status for anyone who can read the patient, and for `patient.portal.manage` an invite button that shows the one-time activation code once, and "Disable access" with a reason. See [portal-app.md](portal-app.md).

Response types are mirrored in `lib/api/types.ts` because `layer:ui` projects may not import backend libraries. Move them into `type:contract` libraries, or generate them from the OpenAPI document, as domains grow.

## Patient timeline

The patient record has a **Timeline** button and a **Recent activity** card (the latest five entries) from `GET /patients/:id/timeline` ([patient-timeline.md](../domains/patient-timeline.md)). `/patients/[id]/timeline` is a page of its own rather than a tab of the record, because the record is one long server-rendered page and the timeline needs its own URL state (filters), paging and audit per view:

- **Grouped by day**, newest first, times from the `libs/ui` format helpers (facility time zone), drawn by the design system's `RecordTimeline`.
- **Filters in the URL**: kind chips (Visits, Prescriptions, Laboratory, Dental, Care plans, Billing, Messages, Imported history, Documents → the API's `kinds`) and a date range (`from`/`to`, local dates). **Load more** fetches the next page by cursor in a server action (`timeline-actions.ts`).
- **Links to existing screens only** (`lib/timeline-mapping.ts`): encounter workspace (encounters, prescriptions, laboratory orders from a consultation), day schedule of the practitioner (appointments), teleconsultation, the record's laboratory and imported-history sections, dental record, care plan, invoice. Messages and documents have no screen and are not linked.
- **Status is icon + text** (`entryStatus`); entries entered in error, cancelled or void are struck through with a marker instead of a status; laboratory releases carry an Abnormal/Critical badge when flagged.
- **Withheld kinds**: when the API leaves kinds out for the user's role, the page says "Some records are not shown to you" — without naming or counting them.
- Every timeline request (including the record's Recent activity card) is audited by the API as `patient.timeline.view`. The design system's demo `PatientTimeline` stays on `/preview/patient-360` with fixtures only.

## Queue and appointments

Front-desk flow: find the patient → **Check in (walk-in)** or **Book appointment** on the patient record → the queue board or day schedule.
Nurse flow: queue board → select a ticket → **Triage & vitals** (`/queue/visits/[id]/triage`) → "Complete triage" moves the patient to _Ready for provider_ ("Save, keep in triage" leaves them in triage).

- **Facility-scoped.** `/queue`, `/queue/walk-in`, `/appointments` and `/appointments/new` need a facility selected in the top bar (the queue, check-in and schedule belong to a facility; the day and its time zone come from the facility).
- **Server actions** (`app/(staff)/queue/actions.ts`, `app/(staff)/appointments/actions.ts`) call the API and return `{ ok, data } | { ok: false, message, code }` (`lib/api/action-result.ts`), so forms show API errors instead of crashing. Walk-ins and bookings send an `Idempotency-Key` per attempt.
- **Optimistic locking.** Every move, call, confirm, cancel and no-show sends the row's `version`. A `409 version_conflict` (someone else acted first) shows a message and refreshes the screen.
- **Rules stay in the API.** `lib/clinic-mapping.ts` maps API rows to the design system's `QueueBoard` and `AppointmentCard` and decides which buttons to offer by mirroring `libs/clinic` (queue transitions; check-in only on the appointment's day; no-show only after the start time). The API enforces the rules either way.
- **Minimal identification.** Queue and schedule rows carry only a patient brief (number, display name, sex, age), not contacts or clinical details. Listing a schedule is audited (`appointment.list`).
- **Triage** (`POST /queue/visits/:id/triage`, `clinic.triage.write`) records the assessment and optional vital signs in one API transaction. The page shows the allergy banner and previous vitals (needs `clinical.read`), as the clinic rules require allergies to be visible at triage. `lib/triage-form.ts` mirrors the API's plausibility limits so typos are caught before submitting (they are data-entry guards, not clinical reference ranges); the API re-checks and its `implausible_vital_signs` details are shown on the fields. Values are never auto-corrected. BMI is shown for display only.
- **Live updates.** The queue page and the dashboard's clinic section subscribe to the API's Socket.IO `/realtime` gateway (`components/live-queue.tsx`). The browser never holds an access token: a server action (`realtimeTicket`) calls `POST /auth/realtime-tickets` and hands the browser a 60-second ticket bound to the session and the selected facility, plus the socket URL; each reconnection fetches a fresh one. On `queue.updated` (ids and status only) the page re-renders from the server (`router.refresh()`, debounced), so details are always re-read through the authorized API. While the socket is not live the page polls every 15 s (visible tabs only); while live it re-reads every 2 minutes as a safety net. The indicator next to the board says "Live", "Connecting…" or "Updates every 15 s". The laboratory workbench and the critical-results page do the same on `lab.updated` (`useLabUpdates`), and the dashboard listens for both on one socket.

## Management dashboard

`/management` (`management.dashboard.read`): figures across clinic, laboratory, dental, billing and the Patient Master for a
range of days and a facility or the whole organization — see [management-dashboard.md](management-dashboard.md).

## Dashboard

`/` shows **Clinic today** for the selected facility (`clinic.dashboard.read`), from `GET /clinic/dashboard`:

- Figures: appointments, waiting, with provider, seen, average wait and no-show rate (links only to screens the user may open).
- **Attention required** (`lib/dashboard-mapping.ts`): a current wait longer than 45 minutes (the queue board's threshold), unsigned encounters at the facility, patients who left without being seen, and overdue / due-this-week care-plan activities (`GET /care-plans/activities/due`, with `care-plan.read`). Operational thresholds only, no clinical rules.
- **Next patients**: today's open appointments that have not ended — the user's own if their account is linked to a practitioner, otherwise the facility's.
- Provider workload (booked, seen, waiting) and the live queue board (`clinic.queue.read`).
- **Laboratory** (facility): with `lab.dashboard.read`, work waiting per stage, STAT open, released today, average collection-to-release time and rejections (`GET /laboratory/dashboard`); with `lab.result.read`, critical results not yet acknowledged and tests past their turnaround time in the attention list; with `lab.qc.read`, a _Laboratory quality_ list (`GET /laboratory/quality/summary`, mapped in `lib/dashboard-mapping.ts`): open nonconformances, QC rejected or not run, tests refusing results, storage units out of range or due a reading, instruments, EQA rounds and competency.

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
- **Laboratory orders** (`lab.order.create`, open encounter, account linked to a practitioner): **Order tests** picks tests and panels (a panel's tests are ticked for it), priority (routine or STAT), clinical indication (pre-filled from the active diagnoses) and notes, with a fasting reminder; one `Idempotency-Key` per form. Each order shows its tests' progress; results appear only once released, with the laboratory's flag and reference range, and corrections are labelled. An order without results can be cancelled with a reason (`lab.order.cancel`). The clinical context pane lists the patient's recent released results.
- Referrals and printing prescriptions are not in the workspace yet. The **recall list** (`/clinic/care-plans`, `GET /care-plans/activities/due`) shows open activities of active plans that are overdue or due within 7, 30 or 90 days (filter by activity type), with the patient's number and name (no contact details), the plan, and Book / Done / Cancel; booking returns to the list and links the appointment. The dashboard's care-plan items link here.

## Configuration

`API_BASE_URL` (server-side, default `http://localhost:3333/api/v1`). `REALTIME_URL` (default: the API origin + `/realtime`) is the one address the **browser** connects to; in production route `/realtime` to the API through the same trusted proxy (WebSocket only; the socket accepts nothing but a ticket or token). The API's `CORS_ORIGINS` is irrelevant to the staff app's server-to-server calls but still lists the web origins for any direct browser use.

## Laboratory

Laboratory staff work at the selected facility (`docs/domains/laboratory.md` has the rules; the API enforces all of them).

- **Workbench** (`/laboratory/worklist?stage=`, `lab.order.read`): stage tabs with counts — _Collect, Receive, Enter results, Verify, Approve, Release_ — STAT first, filterable by department. The page opens on the first stage the user can act at. **Scan accession** (F2 focuses it; scanners type the number and Enter) opens that specimen with every action that applies now, whatever the tab.
- **Collect** groups an order's tests by specimen type; **Collect serum** (etc.) assigns the accession number, shown in a toast with **Print label**. Every specimen (except a rejected one) has **Print tube label** (`lab.specimen.collect`): a PDF label with the accession as a Code 128 barcode (`/files/specimen-labels/:id`). **Receive specimen** and **Reject specimen…** (reason; recollect or cancel the tests) follow.
- **Enter results**: one field per test by result type (number with unit, a list for coded tests, text); several results save in one go and errors stay on their fields. The API flags values against the range for the patient's sex and age and snapshots it.
- **Sign-off**: each result shows value, unit, flag (icon and text), the reference range snapshot, who entered, verified, approved and released it (self sign-offs are labelled), and version and correction reason. **Verify / Approve / Release** (and "… all N" for a specimen) follow the result's status; the API refuses a sign-off by the person who entered the result unless the facility policy allows it, and the refusal is shown as is. **Correct…** (value and reason; released results need `lab.result.amend`) adds a new version that is signed off again; **Cancel result…** is for unreleased results.
- **Quality control** (`/laboratory/qc`, `lab.qc.read`): the QC board (each test on each instrument: latest run per control level in the facility's QC window, the decisive status, whether patient results are allowed), **Record a control** (`lab.qc.enter`; evaluated on save with the facility's Westgard rules), the Levey-Jennings chart (z-scores; shape shows accepted / warning / rejected) with run history and corrective actions, and control material / lot / target setup (`lab.qc.manage`). **Instruments** (`/laboratory/instruments`): register, status, last calibration (overdue flagged) and maintenance, and the log. Result entry and corrections on the workbench name the instrument; each result shows the QC state snapshotted at entry. **Temperatures** (`/laboratory/temperatures`), **Nonconformances** (`/laboratory/nonconformances`, with a detail page for the investigation and closing), **Proficiency testing** (`/laboratory/eqa`) and **Competency** (`/laboratory/competency`) follow the same permissions. See [laboratory-quality.md](../domains/laboratory-quality.md).
- **Send-outs** (`/laboratory/send-outs`, `lab.order.read`; acting with `lab.specimen.receive`, rejections with `lab.specimen.reject`): _To dispatch_ groups prepared send-outs by reference laboratory with a dispatch form (courier, waybill; one `Idempotency-Key` per form) and opens the manifest PDF (`/files/send-out-manifests/:id`); _Awaiting results_ shows time out, expected-by and overdue (colour, icon and text), with **Results back** (the reference laboratory's accession number), **Rejected** (its reason) and **Cancel**; _Closed_ lists outcomes. Recent dispatches link their manifests and offer **Send electronically**, which the API refuses while the interface is an integration dependency. The workbench shows the send-out counts, each specimen's referred tests, **Send to a reference laboratory…** for received tests, and labels entry from a reference laboratory's report; results show **Performed by …** (also on the patient record). Reference laboratories and the facility's referred tests are managed in the catalog.
- **Critical results** (`/laboratory/critical`): each alert shows the patient, test, value and range and the ordering practitioner. Laboratory staff (`lab.critical.manage`) document who was told, how, and whether the value was read back; the ordering side (`lab.result.read`) acknowledges. The ordering practitioner also gets an in-app notice.
- **Catalog** (`/laboratory/catalog`; editing with `lab.catalog.manage`): tests with their current ranges, **+ Range** (a range for the same sex and ages replaces the current one from now on), activate/deactivate, new tests, departments, specimen types, panels, and the facility's laboratory policy (changes need a reason).
- **Patient record**: _Laboratory results_ (with `lab.result.read`) lists the latest released result per test; **Trend** draws released values of one analyte over time with the latest range shaded, and a table keeps each value's own range. Mixed units are shown as a table only. Trends are labelled as a display aid. _Archived laboratory reports_ (`lab.order.read` + `lab.result.read`) lists each archived version of the patient's released reports (order, version, whether it includes a correction) and opens the stored PDF (`/files/lab-report-archive/:id`).
- `lib/lab-mapping.ts` holds the display rules (flag vocabulary, value and range text, stages, grouping, trend points); it never re-interprets a result.

## Online consultations

Doctor flow: **Telemedicine** (`/telemedicine`, `telemedicine.read`) lists the facility's online consultations for today — waiting patients first with how long they have waited, then by time — with whether the questions are answered and red flags. **Review and start** opens `/telemedicine/[appointmentId]` (the pre-consult answers; it refreshes until the patient is in the waiting room), and **Start consultation** (`telemedicine.conduct` + `encounter.write`) opens the telemedicine encounter and goes to the encounter workspace.

- In the workspace, a **telemedicine panel** sits above the note: **Join video** (a room token from the API; `VideoCall` in `@healthcare/ui/healthcare`, the browser side of the LiveKit adapter), the callback number, the pre-consult answers (open when there are red flags), **End consultation…** and **Escalate to in-person care…** (reason for the record; instructions for the patient). After ending, instructions can still be edited, and an escalated consultation offers **Book the in-person visit**. Everything else — note, diagnoses, prescriptions, lab orders, care plans, signing — is the ordinary workspace.
- Without video configured the panel says so and shows the callback number.
- The list uses the live queue refresh (the waiting-room check-in is a queue update).

## Billing

`/billing` and its sub-pages (navigation shows Billing to users with `billing.charge.read`; a selected facility is
required). Server actions in `app/(staff)/billing/actions.ts`; amounts travel as integer centavos and are typed and
shown in pesos with `lib/billing-mapping.ts` (`parsePesos`, `peso`, invoice state). The invoice workspace keeps the
invoice each action returns, so quick successive changes use the latest version without waiting for the page refresh.
Each payment, refund, deposit, deposit application and credit note form carries its own idempotency key (a retried
submit is recorded once; a new key after success). The patient's billing page shows the deposit and credit balance
(`patient-account.tsx`) and packages (`patient-packages.tsx`); the invoice workspace applies deposit, issues credit and
debit notes and shows online payments and the VAT breakdown (`invoice-notes.tsx`); settings hold the tax profile,
packages and number ranges (`billing-profile.tsx`). The patient record links to the patient's billing page. The API recomputes and enforces every amount and
rule; see [billing.md](../domains/billing.md#screens).

## Disease reporting

`/reporting` (navigation shows it to users with `doh.report.manage`): case reports opened when a recorded diagnosis
matches the organization's reportable conditions, to review first; `/reporting/[caseReportId]` shows the prepared
report, what is missing, and the decision (reference from DOH's own channel, dismiss with a reason; submit only when
an adapter is connected). `/reporting/settings` (`doh.settings.manage`): reportable conditions and the selected
facility's DOH health facility code. Server actions in `app/(staff)/reporting/actions.ts`. See
`docs/interoperability/doh-reporting.md`.

## PhilHealth eligibility

On the patient record, a **PhilHealth eligibility** card (users with `philhealth.eligibility.manage`): the history of
checks and a form to record PhilHealth's answer from its own channel (date of service, answer, reference, note; a
selected facility is required). The PhilHealth claim panel on an invoice shows the latest answer for its dates of
service (information, not a condition). See `docs/interoperability/philhealth-eligibility.md`.

## Integrations (administration)

`/admin/integrations` (`integration.exchange.manage`): outbound exchanges needing attention — unsuccessful and
unresolved, or stalled — with a link to the source to prepare the request again, re-queue for stalled exchanges, and
resolve with a note. Labels for systems/operations and source links live in
`app/(staff)/admin/integrations/exchange-labels.ts`. See `docs/architecture/integration-worker.md`.

## Inventory

`/inventory` (`inventory.read`; a selected facility is required): stock by location, item and lot with expiry and
reorder status (filters: low or out, expiring), and a form to record a movement (receive, issue, transfer; count and
write off with `inventory.adjust`). `/inventory/movements`: the ledger. `/inventory/catalog`
(`inventory.catalog.manage`): items, storage locations, suppliers, reorder levels and reorder quantities.
`/inventory/purchase-orders`: open and past orders, what to reorder, a new order (`inventory.procurement.manage`, lines
can be filled from the reorder list); `/inventory/purchase-orders/[id]`: lines and totals, submit, approve (someone
else), receive a delivery (lots, expiry, delivery reference), cancel or close short, invoiced quantities per line, the
order's supplier invoices and **Record a supplier invoice** (`inventory.procurement.manage`; lines prefilled with what was
received and not yet invoiced, at the order's price). `/inventory/supplier-invoices` (open, overdue, paid, void, all) and
`/inventory/supplier-invoices/[id]`: lines with order and invoiced prices (differences marked with ▲/▼ and text), VAT as
stated, total, history, **Approve** (someone else; a note when prices differ), **Mark paid**, **Void**.
`/inventory/valuation` (`inventory.valuation.read`): stock value, unvalued stock, value by category and location, stock at
cost per item, and received and used in a period. See `docs/domains/inventory.md`.

## Pharmacy

`/pharmacy` (`prescription.dispense`): find a prescription by its number; today's dispenses at the facility.
`/pharmacy/[prescriptionId]`: the patient's identification, allergy warnings the prescriber overrode, what was prescribed,
dispensed and remains; dispense from stock (per item: stock item and location, quantity in its unit; needs
`inventory.move`); reverse a mistaken dispense with a reason. See `docs/domains/prescription.md`.

## Dental

`/dental` (`dental.record.read`; a selected facility is required): today's dental patients — dentists' encounters at
the facility with whether each has been charted and how many procedures were recorded. `/dental/patients/[id]` (also
"Dental record" on the patient record): the odontogram in the facility's notation (permanent, mixed or primary
dentition; each tooth shows glyph + chart code, never colour alone), a tooth's state, source and full history; with
the patient's dental visit in progress (or **Start dental visit**, which opens an encounter for the signed-in dentist),
**Chart examination** edits a draft copy and sends only the changed teeth; treatment plans (propose phased items,
record the patient's decision item by item, cancel items, discontinue; an open plan shows its fee estimate — listed
price per item ahead, "No listed price", totals, the estimate each decided item carried — and **Print estimate**); procedures (optionally from an accepted plan
item), each with a **Supplies used** panel (opened after recording: prefilled from the procedure's template, stock
location, issued from inventory with the lots shown, refusals inline next to the supply; return unused supplies);
examinations; periodontal charts (a row per present tooth: six probing depths and margins, bleeding, plaque,
suppuration, mobility, furcation where the tooth has one; view a chart with the changes since the previous one);
imaging (upload through the staff server as an `imaging` document, ≤ 10 MB; open via a signed
link; share with the patient in MyHealth and stop sharing — `dental.imaging.release`); plans decided by the patient
in MyHealth are marked as such. `/dental/settings` also holds "Dental records in MyHealth" and, when on, "Treatment plan
decisions in MyHealth" with the organization's acknowledgement text, and "Fee estimates" (the organization's note
under every estimate; whether MyHealth shows them). Records are corrected by marking them entered in error with a reason. "Notes & prescriptions" opens the
visit's encounter workspace. `/dental/settings`: the procedure catalog, supply templates per procedure, the facility's tooth notation and
default supply location, and whether patients see their dental records in MyHealth, with what they would see (`dental.settings.manage`). Display helpers (notation, tooth and surface names, chart codes) live in
`libs/domain/src/dental.ts`; the odontogram and tooth editor in `libs/ui/src/healthcare/odontogram.tsx`. See
`docs/domains/dental.md`.
