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
- `crm_setting` (migration `0131`, one row per organization, off until set) — the organization's limits on how often and
  when outreach goes out: a **frequency cap** (`cap_max_campaigns` in `cap_window_days`) and **quiet hours**
  (`quiet_start`–`quiet_end` in Asia/Manila time, across midnight if the start is later; `quiet_channels` of `sms`,
  `push`, `email`, default `sms` and `push`). Optimistic `version`; changes audited (`crm.settings.update`).
- `crm_campaign.include_booking_link` (migration `0131`) — the message ends with a link to book a visit in MyHealth.

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

## Reach, limits and the booking link

- **Reach before sending.** A segment preview (`GET /outreach/segments/:id/preview`) and a campaign's reach
  (`GET /outreach/campaigns/:id/reach`, staff **Check reach** on the campaign page) say, per channel, how many patients can
  be messaged and why the others cannot (`no_outreach_opt_in`, `opted_out`, `no_mobile_number`, `no_email_address`,
  `no_push_device`, `no_portal_account`). It asks the same recipient directory the notification service asks when it sends
  (port `CrmReachSource`, adapter `AppCrmReachSource`), so the figures are what a send would do; counts only, no names; at
  most the first 2,000 patients are checked (`sampled`). The campaign view also says how many patients the frequency cap would
  hold back and whether quiet hours would hold its messages now. Audited (`crm.campaign.reach`, and in the preview's audit).
- **Frequency cap.** Before messaging a patient the runner counts the **other** outreach campaigns that actually went to them
  (a delivery `queued` or `delivered`, not a suppressed one) in the window; at or over the cap the patient is skipped on every
  channel and each skipped channel is recorded as `suppressed` with reason `frequency_cap` and no notification. It covers
  outreach campaigns only, not care-plan recall, no-show follow-up or other messages about care, appointments or bills.
- **Quiet hours.** A message on a quiet channel that would go out inside the period is created with `scheduled_for` at the end of
  the period (the notification service queues it with that delay) and its delivery row says `queued` with reason
  `held_for_quiet_hours`; the campaign summary counts them (`heldForQuietHours`). Outside the period, nothing changes. MyHealth
  inbox messages are never held. An explicit `send_at` inside quiet hours is held the same way.
- **Who sets them.** `GET /outreach/settings` needs `crm.read`; `PUT /outreach/settings` needs `crm.campaign.approve` (the people
  who approve campaigns, so an author cannot loosen the limits for their own campaign). Staff `/outreach/settings`.
- **Booking link.** A campaign can end its message with `Book a visit: <PORTAL_BASE_URL>/appointments/book` (MyHealth's booking page),
  chosen while drafting and approved with the wording. The address carries nothing about the patient: signing in identifies
  them. The link counts against each channel's length (`wording_invalid` names the channel) and needs `PORTAL_BASE_URL`
  (`portal_base_missing`). The notification template `outreach.campaign` renders it before the opt-out link.
- Not built: clicks or bookings attributed to a campaign (a tracking link would identify the patient; the audit and the
  appointment list show bookings), per-channel caps, caps that include care reminders, quiet hours per facility or time zone.

## Wording variables and one message per patient

- **Variables.** A campaign's wording (subject and body) may contain `{{firstName}}` and `{{clinicName}}`, filled in for each patient
  when the message is created: the first word of their given name (at most 30 characters, "there" if empty) and the organization's
  name. These two are all there is: nothing clinical, and no appointment, balance or contact detail, can be put in a message this
  way. Any other `{{name}}` is refused while drafting (`wording_invalid`, naming it). What the second person approves is the
  wording with its placeholders; the message each patient receives is stored on its notification (the communications log still
  shows no content). Pure rules `renderWording`, `firstNameOf`, `unknownPlaceholders`, `renderedLength` in `crm.rules.ts`; the staff
  form mirrors them in `lib/outreach-mapping.ts` (the API is authoritative).
- **Length.** Each channel's limit is checked against the **longest** the message can become: a first name of 30 characters, the
  organization's real name, and the booking link when present. So whatever was approved always fits, for any patient.
- **Delivery mode** (`crm_campaign.delivery_mode`, migration `0132`, chosen while drafting and approved with the wording):
  `all` (default: every channel named, as before) or `first_available`: one message per patient, on the first channel that can reach
  them, tried in the order push, text message, email, MyHealth inbox (`CHANNEL_PRIORITY`). The channel is chosen at the time of the
  send from the same consent checks as the reach figures. The delivery record holds one row for the patient: the channel used, or,
  when none can reach them, the first channel in that order with the reason it was not sent (so the record still says why). The
  frequency cap and quiet hours apply as before. A rerun after an interruption skips patients already handled. A campaign's reach
  says how many patients each channel would carry and how many none reaches (`plannedChannels`).
- Not built: variables beyond these two (a clinic phone number is not offered because a campaign is not tied to one facility; type it in
  the wording), a choice of channel order, per-patient channel preference.

## Open questions / assumptions

- **Compliance dependency.** The platform enforces an explicit opt-in per channel, a second person's approval, the
  exact wording sent, and an opt-out link in emails. Whether the opt-in wording and process meet the Data Privacy Act
  and National Privacy Commission requirements for direct marketing, and any rule on unsolicited messages, are the
  organization's to validate (compliance register, "Patient outreach").
- SMS "STOP" replies need an SMS provider with inbound messages; none is selected, so text-message opt-out is through
  MyHealth or the clinic.
- The frequency cap and quiet-hour values are the organization's own policy: the platform sets none by default and encodes no
  rule on how often or when people may be contacted (compliance register, "Patient outreach").
- Not built: segmentation by clinical data (decision first), recurring campaigns, saved message templates,
  delivery analytics beyond counts, recipients outside the organization.
