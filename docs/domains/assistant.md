# Heuristic assistant

## Purpose

Decision support that notices what a screen does not, using fixed rules and simple statistics over data the caller may
already read. It suggests and links; it never changes a record, never diagnoses and uses no language model. Design and
phases: `docs/architecture/heuristic-assistant.md`; decision: ADR-0018. Built: phase 0 (the kernel, settings and feedback,
the API, the first stock rule, the settings screen), phase 1 (operational rules on the inventory, billing, appointments
and queue screens, and the replay behind **Try these values**) and phase 2: the doctor's workspace (the consultation
checklist, code suggestions and the laboratory delta check), integrity and security (unusual record access, compliance
areas to review, invoices that may have been issued twice), order sets and outreach (an order set offered in a
consultation; when patients use MyHealth, audiences worth a segment and patients receiving many campaigns on the outreach
screen), and the staff command bar (Ctrl+K).

## Entities

Migration `0152_assistant.sql`; Drizzle mirrors in `apps/api/src/app/assistant/assistant.schema.ts` (API-owned, ADR-0011).

- `assistant_rule_setting` — append-only versions per organization (or one facility) and rule: `enabled`, `parameters`
  (JSON checked by the rule's schema). The latest version of the facility's row, else the organization's, is in force.
  A rule with no row is **off**.
- `assistant_feedback` — append-only: who answered which finding (`rule_id`, `rule_version`, `subject_key` from the
  suggestion id) with `accepted | dismissed | not_useful` and an optional reason. No names, values or record text.
- Suggestions are computed on demand and not stored. Migration `0153` changes no table (permissions only). Migration
  `0155` adds the laboratory's order sets (`docs/domains/laboratory.md`, "Order sets"), not an assistant table.

## Rules

A rule is a `RuleDefinition` (`libs/core` `assistant/suggestion.ts`: id, version, domain, the screens it speaks on, the
permissions it needs, a parameter schema, starting values and `parameterLabels`) plus a pure function in its domain
library, a read query in that library, and a binding in `apps/api/src/app/assistant/assistant-rules.ts`. Raise `version`
when its logic or the meaning of a parameter changes; dismissals are per version. Every starting value is a starting
point the organization changes, never a standard.

| Rule                                 | Screen        | Library (query)                                                     | Says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Needs                                |
| ------------------------------------ | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `inventory.days-of-cover`            | Inventory     | `inventory` (`InventoryAssistantQueries`)                           | Usable stock plus open orders lasts less than the delivery time at the recent pace; a quantity to cover the chosen days.                                                                                                                                                                                                                                                                                                                                                                                                                                | `inventory.read`                     |
| `inventory.usage-spike`              | Inventory     | `inventory`                                                         | An item issued far above its usual week: above the mean of earlier weeks plus `spread` swings (standard deviation, never below a tenth of the mean). Points to the movements: demand, a mistaken entry or loss.                                                                                                                                                                                                                                                                                                                                         | `inventory.read`                     |
| `inventory.expiry-exposure`          | Inventory     | `inventory`                                                         | A lot expected to expire unused: lots are used up in expiry order (FEFO) at the recent pace; what a lot still holds at its expiry. An item not issued in the window is expected to use nothing.                                                                                                                                                                                                                                                                                                                                                         | `inventory.read`                     |
| `billing.uncharged-work`             | Billing       | `billing` (`BillingAssistantQueries`) + clinic/dental               | Clinic and dental procedures with no charge some hours later, grouped by code and the likely reason: no billing service for the code (advice: may be deliberate), no price on that day, or not captured (warnings). Counts.                                                                                                                                                                                                                                                                                                                             | `billing.charge.read`                |
| `clinic.no-show-risk`                | Appointments  | `clinic` (`ClinicAssistantQueries`)                                 | An appointment of the day whose patient missed a large share of their past appointments here (records merged into theirs counted). Named by time, never by patient; information only once confirmed.                                                                                                                                                                                                                                                                                                                                                    | `appointment.read`                   |
| `clinic.queue-wait`                  | Queue         | `clinic`                                                            | Patients waiting to be called longer than a percentile of this facility's past waits for the visit type (check-in to call, visits never sent back in line). Counts; never reorders the queue; no link.                                                                                                                                                                                                                                                                                                                                                  | `clinic.queue.read`                  |
| `clinic.encounter-checklist`         | Consultation  | `clinic` (`EncounterAssistantQueries`)                              | Before a consultation in progress is signed: what the record does not hold yet (chief complaint, vital signs in person within N hours, allergy review, assessment, plan, a diagnosis, its code when a coding system is active, a primary one). One suggestion listing them; blocks nothing; checks for vital signs and codes are 1/0 parameters.                                                                                                                                                                                                        | `encounter.read`                     |
| `clinic.code-suggestions`            | Consultation  | `clinic`                                                            | For each uncoded diagnosis (or the assessment when there is no diagnosis yet): up to three codes the organization itself used whose descriptions share at least N% of their words with the text (`libs/core` `assistant/text-match.ts`), with the matching words and how often each was used. A code counts only after `minUses` (≥ 2) uses, so a one-off description never shows. Never applied.                                                                                                                                                       | `encounter.read`                     |
| `laboratory.delta-check`             | Laboratory    | `laboratory` (`LabAssistantQueries`)                                | A numeric result entered but not yet released that differs from the same patient's last released result of the same test (same unit, within N days) by at least N%. Names the order, never the patient; links to the next stage's worklist; changes nothing.                                                                                                                                                                                                                                                                                            | `lab.result.read`                    |
| `security.unusual-access`            | Audit log     | `audit` (`AuditAssistantQueries`)                                   | Staff accounts whose record access in the last N hours stands out in the audit trail: distinct patients opened at least N times the account's usual working day (median of the 28 days before, days with at least one; never below a minimum), patients opened outside the organization's working hours (facility time zone), or refused requests. Names the account (names from `UsersService`), links to its audit trail; counts only; blocks nothing. Reads the whole organization's trail.                                                          | `audit.read`                         |
| `admin.compliance-gaps`              | Settings home | `organization` (`OrganizationAssistantQueries`)                     | Compliance areas (`compliance_review`) never reviewed, last reviewed over N months ago, or last found "changes needed" (warning), in one suggestion whose id follows the gaps (a dismissal lasts until they change). Says nothing about whether the configuration is right.                                                                                                                                                                                                                                                                             | `compliance.review.manage`           |
| `billing.possible-duplicate-invoice` | Billing       | `billing` (`BillingAssistantQueries`)                               | Two invoices at the facility issued within N hours, not void, for the same patient (merged records included) with the same net total and the same services. Names the invoice numbers, never the patient; times in the facility's zone; links to the later one; changes nothing.                                                                                                                                                                                                                                                                        | `billing.charge.read`                |
| `laboratory.order-sets`              | Consultation  | `laboratory` (`LabOrderSetService`, `LabAssistantQueries`) + clinic | An active order set of the organization whose triggers match the consultation in progress: a diagnosis code starting with one of its prefixes (in its coding system, or any) or the visit's visit type (from `EncounterAssistantQueries.orderSetContext`), while some of its tests are not ordered in the consultation yet. Lists its tests and panels as "to order" or "already ordered"; links to the lab order form with the set pre-selected (`?orderSet=`); the doctor checks and places the order. At most N sets.                                | `encounter.read`, `lab.order.create` |
| `crm.send-hour`                      | Outreach      | `audit` (`AuditAssistantQueries.portalVisitsByHour`) + `crm`        | The hours patients use MyHealth most (Asia/Manila): per hour, accounts that did anything in MyHealth that hour of a day, over N days; the N-hour window with the most visits that does not start in quiet hours. Silent below a minimum of visits, or when recent campaigns already start at about that time (80% of the best); advice when they start at a quieter time; weak when use is spread over the day. Counts only.                                                                                                                            | `crm.campaign.manage`                |
| `crm.audience-ideas`                 | Outreach      | `crm` (`CrmAssistantQueries`) + clinic (`returnFigures`)            | A segment the organization does not have yet, counted through the same matching as a segment preview: patients not seen for longer than the time within which N% of its returning patients came back (gaps between one patient's completed consultations over two years, linked records as one; none without enough returns; skipped when a segment already selects by the last visit), and next month's birthdays in the month's last N days (skipped when a segment has that month). Links to the segment form filled in. Non-clinical criteria only. | `crm.segment.manage`                 |
| `crm.frequency-load`                 | Outreach      | `crm`                                                               | At least N patients received N or more outreach campaigns (queued or delivered) in N days, and the frequency cap does not already prevent that many. Links to the outreach limits; holds nothing back.                                                                                                                                                                                                                                                                                                                                                  | `crm.campaign.approve`               |

Composition: billing never reads clinical tables (`libs/billing/CLAUDE.md`), so the API takes the procedures from
`ClinicAssistantQueries.proceduresPerformed` and `DentalAssistantQueries.proceduresPerformed` and asks billing only for
the charge, service and price state of those ids and codes. Clinic and dental never learn about charges.

What the rules read, never: no diagnosis, result, age, sex, address or free text. No-show risk reads attendance only.
The order-set rule reads the consultation's diagnosis codes and visit type, never its notes; the outreach rules read counts
(MyHealth visits per hour, patients a criterion matches, campaigns per patient), never a patient.

## Moments and replay

Every binding runs at a **moment** (`RuleMoment`: as-of instant, the facility's local day and its bounds, time zone, live
or not), so a rule can read now or a past day. Each query rebuilds its state from timestamps: stock is the ledger summed
up to the moment (the ledger is append-only and every balance is its sum), appointments from booked, confirmed, cancelled,
checked-in and no-show times, the queue from check-in, call, triage and consultation times, procedures from performed,
recorded and entered-in-error times, charges from their capture time. Open purchase orders are counted only live (past
order states are not kept), so a replayed stock rule may fire more often than it would have.

`POST /assistant/rules/:ruleId/replay` (`assistant.configure`, and the rule's own permissions) runs a rule on each of the
last 1–31 days (default 14) at the facility (body or header), each read at the rule's usual local time (`replayAt`: stock
08:00, appointments 07:00, compliance 09:00, queue and outreach 10:00, laboratory 15:00, consultations and order sets 16:00, billing 17:00, record
access 21:00), with given parameters or the
setting in force, else the starting values. Consultation rules read the consultation on screen (`encounterId`); a replay
reads every consultation of the facility started that day and still open at the replay time, and a live request without a
consultation reads none. Consultations rebuild from their start, signing, note revisions, vital signs (and their
entered-in-error time), diagnoses and allergy reviews; a diagnosis's later status changes are not dated, so its current
status stands. Laboratory results rebuild from entry, verification, approval, release, cancellation and supersession. Outreach
rules read MyHealth visits, campaign start times, deliveries and the segments active at the moment (an archived segment
never changes again, so its last update dates the archiving); the frequency cap, quiet hours, the order sets and the
patients a criterion matches are read as they are now. It answers counts per day (suggestions, weak ones), the average and the maximum; nothing is stored; audited
`assistant.replay` with rule, facility and days. This is the plan's "backtest": thresholds are chosen from the
organization's own data before a rule is turned on.

## Commands

- Answer a suggestion (`accepted | dismissed | not_useful`): inserts feedback, audits `assistant.answer`, records
  `AssistantSuggestionActedOn` (ids only). A dismissal hides the same finding from the same person for 14 days.
- Change a rule's setting: inserts the next version after checking the editor's `expectedVersion` (409 when stale),
  validates parameters against the rule's schema (422 `invalid_rule_parameters`, the message naming the field in the
  settings screen's words), audits `assistant.rule-setting`.

## Queries

- Suggestions for a surface at the selected facility (`inventory`, `billing`, `appointments` with an optional `date`,
  `queue`, `encounter` with the `encounterId`, `laboratory`, `security`, `settings`, `outreach`); each request audits `assistant.view` with the surface, rule
  ids, the number shown and the consultation's id, never a finding. Rules
  whose source permission the caller lacks are listed in `withheld` by title, with no counts. A stored setting the rule no
  longer accepts keeps the rule silent until it is saved again. At most 20 suggestions a request.
- Rules with the setting in force for a scope (and, for a facility, the organization's); the replay; insights (answers
  per rule over a period; `reviewSuggested` once at least 20 answers have been given and 70% or more were dismissed or not
  useful. A prompt for the administrator, never an automatic change).

## Events

`AssistantSuggestionActedOn` (aggregate `assistant_feedback`; payload: rule id, rule version, outcome).

## Permissions

Migrations `0152`–`0154` and the `PERMISSIONS` catalog. `assistant.use`: org_admin, inventory_officer (0152), cashier,
receptionist, nurse (0153), physician, dentist, medical_technologist, pathologist (0154); the integrity and security rules
need no new grant (their screens' permissions, `audit.read` and `compliance.review.manage`, are organization administrators'),
nor do the order-set rule (doctors hold `assistant.use` since 0154) and the outreach rules (the outreach permissions are
organization administrators'). `assistant.configure` and `assistant.insights.read`: org_admin. A rule's suggestions also need
the permission of what it reads (table above); without it the rule is withheld.

## API

`/api/v1/assistant`: `GET /suggestions?surface=&date=&encounterId=` (facility header), `POST /suggestions/:id/feedback`,
`GET /rules[?facilityId=]`, `PUT /rules/:ruleId/settings`, `POST /rules/:ruleId/replay`, `GET /insights?days=`.

## UI

`AssistantPanel` and `SuggestionCard` in `@healthcare/ui/healthcare` (Storybook "Healthcare/Assistant"): a "Decision support"
badge, severity as label plus icon, "Based on limited data" for weak signals, **Why?** (basis, evidence, rule and version),
Dismiss, Not useful, and a link as the only action. Presentational: the staff app loads suggestions and sends answers from its
server.

Screens: staff `/inventory` (above the stock table), `/billing` (above the cashier's desk), `/appointments` (above the day
board, for the day shown) and `/queue` (under the figures, through the `assistant` slot of `QueueWorkspace`, only while
someone is in the queue), the consultation workspace `/clinic/encounters/[id]` (top of the centre column through its
`assistant` slot, only while the consultation is in progress) and the laboratory workbench `/laboratory/worklist` (above
the worklist, in the layout's notice area), the audit log `/admin/audit` (record access), the Settings home `/admin`
(compliance areas) and `/outreach` (above the segments). Each loads its surface with `loadSuggestions` (`apps/staff/src/lib/assistant-suggestions.ts`) in
parallel with the page's own data and shows the panel only when there is something to say; a failed assistant request
never breaks the page. `AssistantSuggestions` (`apps/staff/src/components`) sends answers through `answerSuggestion`
(`apps/staff/src/app/(staff)/assistant-actions.ts`), which refreshes that screen.

Two links open a form filled in, never a saved record: an order set's opens the consultation's lab order form with the
set's tests and panels chosen (`?orderSet=`; the page reads the set, `LabOrdersPanel` scrolls to it and says where the
choice came from; the address drops it when the form closes, so a reload cannot reopen it), and an audience idea's opens
the new segment form on `/outreach` with its name and criteria (`?segment=new&…`, read by `segmentDraftFrom` in
`apps/staff/src/lib/outreach-draft.ts`: only known criteria within the API's ranges; the address drops them when the form
closes).

Settings: staff `/admin/assistant` (**Settings → Assistant**, `assistant.configure`) shows every rule for the whole
organization or one facility (`?facility=`): its state, an on/off switch and its parameters labelled from the rule's own
`parameterLabels`, so a new rule needs no screen change; **Try these values** replays the rule over the last 14 days at the
facility of the scope (else the one selected in the top bar) with the values in the form, saved or not, and says how often it
would have spoken. With `assistant.insights.read` the page also shows how staff answered each rule over 90 days. Wording
helpers in `apps/staff/src/lib/assistant-settings.ts` (unit-tested). Manual: chapter 13, "How to turn on the assistant's
suggestions", and each screen's chapter (3, 4, 6, 9, 10, 11).

## Command bar

Not a rule: a way to reach screens and patients by typing (phase 2). **Ctrl+K** (⌘K), or the top bar's **⌘** button, opens it
anywhere in the staff app (`CommandBar` in `apps/staff/src/components/command-bar.tsx`, mounted in the shell). The words are
read by `apps/staff/src/lib/command-bar.ts` (pure, unit-tested; fixed word lists, no model):

- **Days**: today / tomorrow / yesterday (ngayon / bukas / kahapon), weekdays (the next one, today included), "Nov 25",
  "25 Nov 2027", ISO dates, in the facility's time zone; impossible days are ignored.
- **Patient actions** at the start or end (`PATIENT_VERBS`: book, check in / walk-in, bill, labs, visits, 360, timeline,
  history, vaccines, edit, communications, dental, coverage, open), each behind the permissions its page checks; without
  them a patient is offered as "Open the record".
- **Screens**: the navigation, every module tab (`moduleTabsForPermissions`), the Settings pages and shortcuts (register,
  walk-in, book, the lab worklist's stages, low and expiring stock, the waiting-room display, account, notifications, help),
  all from the permissions — the same lists the menu uses — ranked by how many words they hold; screens that show a day
  (`/appointments`, `/calendar`, `/appointments/new`) open the day named.
- **Patients**: what is left after actions, days, filler words and screen words is searched as a name or number (three
  characters or more, 400 ms after typing stops) through the ordinary `GET /patients` (`findPatientsForCommand`, a server
  action; `patient.search`; audited by the API like any search; id, number, name, sex, age and status only).
- **Help**: the two manual sections that best match the phrase, from the sections the shell already has.

Every result is a link; nothing is done for the person. Patients come first when an action was named, screens otherwise.
No API, permission or migration was added.

## Integration points and limits

- Dispensing is not charged by billing, so it is not part of `billing.uncharged-work`; laboratory orders and consultations
  are not checked yet.
- Dismissals are per person, not shared. A dismissed uncharged-work group hides later items of the same code and reason
  for that person too, for 14 days. Nothing is learned automatically.
- Replays read past days at one time of day; the queue rule's answer depends on that hour.
- The consultation and laboratory rules are clinical decision support (CLAUDE.md §35): labelled as such, showing their
  basis, never applied, overridable by ignoring or dismissing, logged, and off until turned on. Each organization's
  clinicians validate a rule and its thresholds before it is turned on (compliance register); no test-specific delta
  limits, triage scale or code set is shipped.
- Code suggestions read other patients' coded diagnoses only as codes, their most common description and a count, and only
  codes used at least twice, so no single patient's free text is offered.
- The delta check compares results with the same unit only; it does not convert units or read reference ranges.
- Record-access suggestions are analytics about staff behaviour from the audit trail. Whether and how staff are told that
  access is reviewed is the organization's (Data Privacy Act; compliance register). Only administrators see them, nothing
  is blocked or sent, and the request is audited with rule ids only.
- An organization's validation of its own configuration is recorded by people; the compliance rule only says what has
  not been recorded. Areas that do not apply (for example dental estimates without dentistry) are dismissed.
- Which tests an order set holds and what it is offered for are the organization's clinical decisions; no guideline or
  national order set is shipped, and nothing is ordered without the doctor.
- The send hour is a statistic over the audit trail's MyHealth activity (counts per hour, no account, patient or action);
  whether the privacy notice covers using it to time outreach is the organization's (compliance register). It says
  nothing about patients without MyHealth or about text messages.
- Audience ideas are fixed (recall from the organization's own return time, next month's birthdays): no clinical
  criterion, and nothing is created or sent until people save a segment and a second person approves a campaign.
