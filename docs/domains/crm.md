# CRM: outreach segments and campaigns

## Purpose

Patient outreach the organization plans, as opposed to the reminders the platform sends on its own (appointment
reminders, care-plan recall, no-show follow-up, waiting-list notices): **who** to contact (segments), **what** to send
(campaigns, approved by a second person), sent through the one `NotificationService` under each patient's explicit
outreach opt-in per channel, with an opt-out link in every outreach email. CLAUDE.md §16: the CRM is subordinate to
healthcare workflows and privacy; nothing here selects people by their health or carries clinical detail.

Library `libs/crm` (`scope:crm`, `type:feature`); the composition root answers who matches a segment
(`apps/api/src/app/adapters/crm-adapters.ts`) and records opt-outs through the patient domain.

## Entities

- `crm_segment` — a saved list definition: name, description, `criteria` (JSONB, validated by `segmentCriteriaSchema`),
  `active | archived`, version. Criteria are **non-clinical**: age range, sex, city/municipality or province of the
  primary address, registered between dates, last completed consultation on or before a date, no completed
  consultation for N months (never seen included), an open care-plan activity due within N days (overdue included),
  opted in to outreach on a channel. At least one criterion. No diagnosis, result or medication criterion exists:
  selecting people by health data for outreach is a compliance decision first (compliance register).
- `crm_campaign` — segment, name, channels (`sms`, `email`, `push`, `in_app`), the organization's own wording
  (`subject` for email and MyHealth, one plain-text `body` for every channel, checked against each channel's length:
  320 / 160 / 2,000 / 2,000), optional `send_at`, status `draft → submitted → approved → sending → completed`, or
  `cancelled` with a reason while not yet sending; `submitted` goes back to `draft` for changes. Who drafted,
  submitted, approved and cancelled, with times. Database checks: the approver is never the author.
- `crm_campaign_delivery` — one append-only row per campaign, patient and channel: the notification created and its
  outcome (`queued`, `delivered`, `suppressed` with the service's reason, `failed`).
- `crm_opt_out_token` — the single-use token behind the opt-out link (hash only), bound to patient, channel and
  campaign, 30 days.

## Commands

- Segments: create, update (optimistic version; archived ones never change), archive (refused while a campaign in
  `draft`, `submitted`, `approved` or `sending` uses it).
- Campaigns: create (draft), update (drafts only; the caller becomes the author), submit, reopen (back to draft),
  approve (`crm.campaign.approve`; refused for the author or the submitter — `approver_is_author`), cancel with a
  reason. Wording that does not fit a chosen channel is refused (`wording_invalid`, with the channel).
- Sending: `CrmCampaignRuns` in the API, every minute under an advisory lock, takes each `approved` campaign whose
  `send_at` has passed (or is null), marks it `sending`, evaluates the segment **at that moment**, and for every member
  and channel calls `NotificationService.send` with the internal template `outreach.campaign` (category `outreach`),
  idempotency key `crm:{campaign}:{patient}:{channel}`. The notification service decides: an explicit outreach opt-in
  on that channel, an active record (never deceased, merged or inactive), a contact detail or a MyHealth account for
  in-app. The outcome is recorded per patient and channel; a run interrupted mid-way continues where it stopped. Then
  `completed`, audited `crm.campaign.run` with counts only.
- Opt-out: `POST /outreach/opt-out { token }` (public): a valid, unused, unexpired token records `opted_in = false` for
  `outreach` on that channel through the patient domain (audited as a preference change by the system actor, with the
  campaign in the reason) and is marked used. The answer is `{ recorded: false }` for anything else and never says
  whether the token existed.

## Queries

- Segments list; segment preview (`GET /outreach/segments/:id/preview`): total and the first 200 members as a work
  list (number, name, sex, age; nothing else), audited `crm.segment.preview` with the counts.
- Campaigns list; one campaign with its **summary** once sending started: patients in the segment, counts by channel
  and outcome, suppressed by reason. Never who received what — that is the communication log, which lists every
  outreach notification under the kind "Outreach campaign".

## Events

None yet (the campaign run audits itself; notifications carry their own lifecycle).

## Permissions

`crm.read` (org_admin, records_officer), `crm.segment.manage`, `crm.campaign.manage`, `crm.campaign.approve`
(org_admin). Migration `0094`. No new system role: organizations compose their own.

## API

`/api/v1/outreach`: `GET|POST segments`, `PUT segments/:id`, `POST segments/:id/archive`, `GET segments/:id/preview`,
`GET|POST campaigns`, `GET|PUT campaigns/:id`, `POST campaigns/:id/{submit,reopen,approve,cancel}`,
`POST opt-out` (public).

## Database relationships

`crm_segment` → organization; `crm_campaign` → segment (same organization, composite FK) and the users who acted;
`crm_campaign_delivery` → campaign, patient (composite) and notification; `crm_opt_out_token` → patient and campaign.

## Integration points

- Ports: `CrmSegmentSource` (who matches; the API reads patient, encounter and care-plan tables — only active
  records) and `CrmPreferenceWriter` (opt-out → `PatientRecordService.setCommunicationPreferences`).
- `NotificationService` with the internal template `outreach.campaign`; the communication policy in `libs/patient`
  (`resolvePatientContact`) is what makes the opt-in rule hold.
- Staff `/outreach` (segments with preview, campaigns with the approval step, `/outreach/campaigns/[id]` with the
  result); MyHealth `/outreach/opt-out?token=` (public page). MyHealth's notification settings already let a patient
  choose outreach per channel.

## Open questions / assumptions

- **Compliance dependency.** The platform enforces an explicit opt-in per channel, a second person's approval, the
  exact wording sent, and an opt-out link in emails. Whether the opt-in wording and process meet the Data Privacy Act
  and National Privacy Commission requirements for direct marketing, and any rule on unsolicited messages, are the
  organization's to validate (compliance register, "Patient outreach").
- SMS "STOP" replies need an SMS provider with inbound messages; none is selected, so text-message opt-out is through
  MyHealth or the clinic.
- Not built: segmentation by clinical data (decision first), recurring campaigns, message templates with variables,
  delivery analytics beyond counts, recipients outside the organization.
