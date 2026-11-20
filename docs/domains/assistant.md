# Heuristic assistant

## Purpose

Decision support that notices what a screen does not, using fixed rules and simple statistics over data the caller may
already read. It suggests and links; it never changes a record, never diagnoses and uses no language model. Design and
phases: `docs/architecture/heuristic-assistant.md`; decision: ADR-0018. Built: phase 0 (the kernel, settings and feedback,
the API, the first stock rule, the settings screen) and phase 1 (operational rules on the inventory, billing, appointments
and queue screens, and the replay behind **Try these values**).

## Entities

Migration `0152_assistant.sql`; Drizzle mirrors in `apps/api/src/app/assistant/assistant.schema.ts` (API-owned, ADR-0011).

- `assistant_rule_setting` — append-only versions per organization (or one facility) and rule: `enabled`, `parameters`
  (JSON checked by the rule's schema). The latest version of the facility's row, else the organization's, is in force.
  A rule with no row is **off**.
- `assistant_feedback` — append-only: who answered which finding (`rule_id`, `rule_version`, `subject_key` from the
  suggestion id) with `accepted | dismissed | not_useful` and an optional reason. No names, values or record text.
- Suggestions are computed on demand and not stored. Migration `0153` changes no table (permissions only).

## Rules

A rule is a `RuleDefinition` (`libs/core` `assistant/suggestion.ts`: id, version, domain, the screens it speaks on, the
permissions it needs, a parameter schema, starting values and `parameterLabels`) plus a pure function in its domain
library, a read query in that library, and a binding in `apps/api/src/app/assistant/assistant-rules.ts`. Raise `version`
when its logic or the meaning of a parameter changes; dismissals are per version. Every starting value is a starting
point the organization changes, never a standard.

| Rule                        | Screen       | Library (query)                                       | Says                                                                                                                                                                                                                        | Needs                 |
| --------------------------- | ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `inventory.days-of-cover`   | Inventory    | `inventory` (`InventoryAssistantQueries`)             | Usable stock plus open orders lasts less than the delivery time at the recent pace; a quantity to cover the chosen days.                                                                                                    | `inventory.read`      |
| `inventory.usage-spike`     | Inventory    | `inventory`                                           | An item issued far above its usual week: above the mean of earlier weeks plus `spread` swings (standard deviation, never below a tenth of the mean). Points to the movements: demand, a mistaken entry or loss.             | `inventory.read`      |
| `inventory.expiry-exposure` | Inventory    | `inventory`                                           | A lot expected to expire unused: lots are used up in expiry order (FEFO) at the recent pace; what a lot still holds at its expiry. An item not issued in the window is expected to use nothing.                             | `inventory.read`      |
| `billing.uncharged-work`    | Billing      | `billing` (`BillingAssistantQueries`) + clinic/dental | Clinic and dental procedures with no charge some hours later, grouped by code and the likely reason: no billing service for the code (advice: may be deliberate), no price on that day, or not captured (warnings). Counts. | `billing.charge.read` |
| `clinic.no-show-risk`       | Appointments | `clinic` (`ClinicAssistantQueries`)                   | An appointment of the day whose patient missed a large share of their past appointments here (records merged into theirs counted). Named by time, never by patient; information only once confirmed.                        | `appointment.read`    |
| `clinic.queue-wait`         | Queue        | `clinic`                                              | Patients waiting to be called longer than a percentile of this facility's past waits for the visit type (check-in to call, visits never sent back in line). Counts; never reorders the queue; no link.                      | `clinic.queue.read`   |

Composition: billing never reads clinical tables (`libs/billing/CLAUDE.md`), so the API takes the procedures from
`ClinicAssistantQueries.proceduresPerformed` and `DentalAssistantQueries.proceduresPerformed` and asks billing only for
the charge, service and price state of those ids and codes. Clinic and dental never learn about charges.

What the rules read, never: no diagnosis, result, age, sex, address or free text. No-show risk reads attendance only.

## Moments and replay

Every binding runs at a **moment** (`RuleMoment`: as-of instant, the facility's local day and its bounds, time zone, live
or not), so a rule can read now or a past day. Each query rebuilds its state from timestamps: stock is the ledger summed
up to the moment (the ledger is append-only and every balance is its sum), appointments from booked, confirmed, cancelled,
checked-in and no-show times, the queue from check-in, call, triage and consultation times, procedures from performed,
recorded and entered-in-error times, charges from their capture time. Open purchase orders are counted only live (past
order states are not kept), so a replayed stock rule may fire more often than it would have.

`POST /assistant/rules/:ruleId/replay` (`assistant.configure`, and the rule's own permissions) runs a rule on each of the
last 1–31 days (default 14) at the facility (body or header), each read at the rule's usual local time (`replayAt`: stock
08:00, appointments 07:00, queue 10:00, billing 17:00), with given parameters or the setting in force, else the starting
values. It answers counts per day (suggestions, weak ones), the average and the maximum; nothing is stored; audited
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
  `queue`); each request audits `assistant.view` with the surface, rule ids and the number shown, never a finding. Rules
  whose source permission the caller lacks are listed in `withheld` by title, with no counts. A stored setting the rule no
  longer accepts keeps the rule silent until it is saved again. At most 20 suggestions a request.
- Rules with the setting in force for a scope (and, for a facility, the organization's); the replay; insights (answers
  per rule over a period; `reviewSuggested` once at least 20 answers have been given and 70% or more were dismissed or not
  useful. A prompt for the administrator, never an automatic change).

## Events

`AssistantSuggestionActedOn` (aggregate `assistant_feedback`; payload: rule id, rule version, outcome).

## Permissions

Migrations `0152` and `0153` and the `PERMISSIONS` catalog. `assistant.use`: org_admin, inventory_officer (0152), cashier,
receptionist, nurse (0153). `assistant.configure` and `assistant.insights.read`: org_admin. A rule's suggestions also need
the permission of what it reads (table above); without it the rule is withheld.

## API

`/api/v1/assistant`: `GET /suggestions?surface=&date=` (facility header), `POST /suggestions/:id/feedback`,
`GET /rules[?facilityId=]`, `PUT /rules/:ruleId/settings`, `POST /rules/:ruleId/replay`, `GET /insights?days=`.

## UI

`AssistantPanel` and `SuggestionCard` in `@healthcare/ui/healthcare` (Storybook "Healthcare/Assistant"): a "Decision support"
badge, severity as label plus icon, "Based on limited data" for weak signals, **Why?** (basis, evidence, rule and version),
Dismiss, Not useful, and a link as the only action. Presentational: the staff app loads suggestions and sends answers from its
server.

Screens: staff `/inventory` (above the stock table), `/billing` (above the cashier's desk), `/appointments` (above the day
board, for the day shown) and `/queue` (under the figures, through the `assistant` slot of `QueueWorkspace`, only while
someone is in the queue). Each loads its surface with `loadSuggestions` (`apps/staff/src/lib/assistant-suggestions.ts`) in
parallel with the page's own data and shows the panel only when there is something to say; a failed assistant request
never breaks the page. `AssistantSuggestions` (`apps/staff/src/components`) sends answers through `answerSuggestion`
(`apps/staff/src/app/(staff)/assistant-actions.ts`), which refreshes that screen.

Settings: staff `/admin/assistant` (**Settings → Assistant**, `assistant.configure`) shows every rule for the whole
organization or one facility (`?facility=`): its state, an on/off switch and its parameters labelled from the rule's own
`parameterLabels`, so a new rule needs no screen change; **Try these values** replays the rule over the last 14 days at the
facility of the scope (else the one selected in the top bar) with the values in the form, saved or not, and says how often it
would have spoken. With `assistant.insights.read` the page also shows how staff answered each rule over 90 days. Wording
helpers in `apps/staff/src/lib/assistant-settings.ts` (unit-tested). Manual: chapter 13, "How to turn on the assistant's
suggestions", and each screen's chapter (3, 9, 10).

## Integration points and limits

- Dispensing is not charged by billing, so it is not part of `billing.uncharged-work`; laboratory orders and consultations
  are not checked yet.
- Dismissals are per person, not shared. A dismissed uncharged-work group hides later items of the same code and reason
  for that person too, for 14 days. Nothing is learned automatically.
- Replays read past days at one time of day; the queue rule's answer depends on that hour.
- No clinical rule exists yet. A clinical rule needs a clinician's sign-off before any organization turns it on.
