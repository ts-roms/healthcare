# Heuristic assistant

## Purpose

Decision support that notices what a screen does not, using fixed rules and simple statistics over data the caller may
already read. It suggests and links; it never changes a record, never diagnoses and uses no language model. Design and
phases: `docs/architecture/heuristic-assistant.md`; decision: ADR-0018. Phase 0 (this document) is the kernel, the
settings and feedback, the API and one rule.

## Entities

Migration `0152_assistant.sql`; Drizzle mirrors in `apps/api/src/app/assistant/assistant.schema.ts` (API-owned, ADR-0011).

- `assistant_rule_setting` — append-only versions per organization (or one facility) and rule: `enabled`, `parameters`
  (JSON checked by the rule's schema). The latest version of the facility's row, else the organization's, is in force.
  A rule with no row is **off**.
- `assistant_feedback` — append-only: who answered which finding (`rule_id`, `rule_version`, `subject_key` from the
  suggestion id) with `accepted | dismissed | not_useful` and an optional reason. No names, values or record text.
- Suggestions are computed on demand and not stored.

## Rules

A rule is a `RuleDefinition` (`libs/core` `assistant/suggestion.ts`: id, version, domain, permissions it needs, parameter
schema, starting values) plus a pure function in its domain library and a binding in `apps/api/src/app/assistant/assistant-rules.ts`.
Raise `version` when its logic or the meaning of a parameter changes; dismissals are per version.

| Rule                      | Library     | Reads                                                                | Says                                                                                                                                                      |
| ------------------------- | ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory.days-of-cover` | `inventory` | usable stock, open purchase orders and issues over a window per item | Usable stock plus open orders lasts less than the delivery time at the recent pace; suggests a quantity to cover the chosen days. Needs `inventory.read`. |

`inventory.days-of-cover` parameters (starting values 30 / 14 / 30 / 5, all the organization's to change): `windowDays`
(pace window), `leadTimeDays` (cover shorter than this is flagged), `targetCoverDays` (days a new order should cover),
`minIssues` (fewer issues in the window: shown as "Based on limited data"; fewer than 2: silent). Warning when cover is
under half the delivery time or stock is zero, otherwise advice. Expired lots do not count as usable; open orders
(approved, partially received) do. It does not touch the reorder levels people set.

## Commands

- Answer a suggestion (`accepted | dismissed | not_useful`): inserts feedback, audits `assistant.answer`, records
  `AssistantSuggestionActedOn` (ids only). A dismissal hides the same finding from the same person for 14 days.
- Change a rule's setting: inserts the next version after checking the editor's `expectedVersion` (409 when stale),
  validates parameters against the rule's schema (422 `invalid_rule_parameters`), audits `assistant.rule-setting`.

## Queries

- Suggestions for a surface at the selected facility; each request audits `assistant.view` with the surface, rule ids and
  the number shown, never a finding. Rules whose source permission the caller lacks are listed in `withheld` by title, with
  no counts. A stored setting the rule no longer accepts keeps the rule silent until it is saved again.
- Rules with the setting in force for a scope; insights (answers per rule over a period; `reviewSuggested` once at least 20
  answers have been given and 70% or more were dismissed or not useful. A prompt for the administrator, never an automatic change).

## Events

`AssistantSuggestionActedOn` (aggregate `assistant_feedback`; payload: rule id, rule version, outcome).

## Permissions

Migration `0152` and the `PERMISSIONS` catalog. `assistant.use` (org_admin, inventory_officer in phase 0; later phases add roles
with their rules), `assistant.configure` and `assistant.insights.read` (org_admin). A rule also needs the permission of what it reads.

## API

`/api/v1/assistant`: `GET /suggestions?surface=` (facility header), `POST /suggestions/:id/feedback`, `GET /rules[?facilityId=]`,
`PUT /rules/:ruleId/settings`, `GET /insights?days=`. Surface in phase 0: `inventory`.

## UI

`AssistantPanel` and `SuggestionCard` in `@healthcare/ui/healthcare` (Storybook "Healthcare/Assistant"): a "Decision support"
badge, severity as label plus icon, "Based on limited data" for weak signals, **Why?** (basis, evidence, rule and version),
Dismiss, Not useful, and a link as the only action. Presentational: the staff app loads suggestions and sends answers from its
server.

Staff `/inventory` loads `surface=inventory` suggestions for holders of `assistant.use` in parallel with the stock and shows the
panel above the stock table only when there is something to say (suggestions, hidden dismissals or withheld rules). A failed
assistant request is swallowed so the stock page always renders. `AssistantSuggestions` (`apps/staff/src/components`) sends
answers through the `answerSuggestion` server action (`apps/staff/src/app/(staff)/assistant-actions.ts`), which refreshes the
page so a dismissed suggestion disappears. Manual: chapter 9, "How to read the stock suggestions".

Settings: staff `/admin/assistant` (**Settings → Assistant**, `assistant.configure`) shows every rule for the whole organization or one
facility (`?facility=`): its state (own setting, following the organization's, or not turned on), an on/off switch and its parameters,
labelled from the rule's own `parameterLabels` (label, unit, hint, range) so a new rule needs no screen change. Saving sends the
scope's `expectedVersion`; the API answers a wrong value in the field's own words. With `assistant.insights.read` the page also shows
how staff answered each rule over 90 days. Wording helpers in `apps/staff/src/lib/assistant-settings.ts` (unit-tested). Manual:
chapter 13, "How to turn on the assistant's suggestions".

## Integration points and limits

- Reads `inventory` only. Cross-domain rules will be composed in the API.
- Day boundaries use Asia/Manila (`todayInPhilippines`), not yet the facility's time zone.
- Dismissals are per person, not shared. Nothing is learned automatically.
- No clinical rule exists yet. A clinical rule needs a clinician's sign-off before any organization turns it on.
