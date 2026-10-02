# Patient messaging (MyHealth conversations)

## Purpose

A patient and the clinic write to each other in conversations, inside MyHealth. It replaces "call the clinic" for
non-urgent questions and lets the clinic ask a patient something and get an answer. It is **not** an emergency
channel, is **not** watched in real time, and is **not** a place to release results or give urgent instructions.
MyHealth says so wherever a patient writes, and staff screens repeat it. A message carries text and up to three
documents of the patient's record (migration `0097`): photos or PDFs the patient uploads, or documents the clinic
holds. Care advice given in a reply is the clinician's own; nothing here decides or suggests anything clinically.

Staff may keep **internal notes** on a conversation that the patient never sees; each facility may **route** a topic
to a role or to one person (optionally assigning on arrival) and set a **response target** in calendar hours, past
which the conversation is marked overdue and the responsible people reminded once.

Not built: auto-replies, canned answers, business-hour targets (targets count calendar hours), escalation beyond the
one reminder, malware scanning of uploads (a dependency of the documents platform), image previews.

## Entities

- `patient_message_thread` — one conversation: `patient_id`, `facility_id` (where the patient is registered: the
  clinic it is routed to), `topic` (`general | appointment | results | medication | billing | other`), `subject`
  (≤ 100), `started_by` (`patient | staff`), `status` (`open | closed`), `assigned_to`, `message_count`,
  `last_message_at` / `last_message_from`, `patient_read_through` (the clinic's messages the patient has read),
  `closed_at` / `closed_by`, `version`. Migration `0076`.
- `patient_message` — append-only (`prevent_mutation` trigger): `sender_type`, exactly one of
  `sender_portal_account_id` (the patient's MyHealth account) or `sender_user_id` (staff), `body` (1–2,000).
- `patient_message_attachment` (migration `0097`) — append-only: a message's documents (`document_id` of the same
  patient, `position` 0–2, one row per message and document). A patient attaches only their own finished uploads
  (`document.source = 'patient_upload'`, `created_by_portal_account`, status `available`; JPEG, PNG, HEIC or PDF, at
  most 10 MB, 10 uploads a day); the clinic attaches available documents of the patient's record that no other domain
  manages. Attachments are opened only behind short-lived signed links the documents platform audits.
- `patient_message_note` — append-only staff notes (`author_user_id`, `body` 1–2,000); never in a portal view, never in
  audit metadata or events.
- `patient_message_setting` — one per facility and topic: `route_role_key` **or** `route_user_id` (or neither:
  everyone who can reply at the facility), `auto_assign` (needs a person), `response_target_hours` (1–168, or none),
  `version`, who last changed it.
- `patient_message_thread.response_due_at` — set when the patient writes (last message at + target hours of the
  facility's setting for the topic), cleared by a staff reply; `overdue_notified_at` records the reminder sent for the
  current target.
- A new conversation under a **merged** record is refused by the database trigger (`PM001` → `422 patient_merged`);
  replies to existing ones are not (corrections of what exists). Reads follow merged records with `filedAsPatient`.

## Commands

| Command                                  | Rules                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient starts a conversation            | Own record active (not merged or deceased); at most **5** open conversations the patient started; at most **10** patient messages per hour (advisory-locked per patient so the limits hold); topic, subject, body validated |
| Patient writes                           | Open conversation of their own record only (another patient's is `404`); closed → `422 thread_closed` (start a new one)                                                                                                     |
| Patient opens a conversation             | Marks the clinic's messages read (`patient_read_through`); audited                                                                                                                                                          |
| Staff replies (`patient.message.manage`) | Open conversation; the replier takes an unassigned conversation; closed → `422 thread_closed`                                                                                                                               |
| Staff starts a conversation              | Active patient **with a usable MyHealth account** (else `422 no_portal_account`), so the patient can read and answer                                                                                                        |
| Assign / release, close / reopen         | Row-locked; audited with before/after                                                                                                                                                                                       |

## Queries

Patient: own conversations (newest first), one conversation with its messages, unread count (also counted in the
navigation badge `GET /portal/messages/unread-count`). Staff: the queue (`filter=awaiting|open|closed|all`,
`assignedToMe`, `patientId`, `facilityId`; conversations waiting for the clinic first, longest wait on top), one
conversation, `awaiting-count`, `overdue-count`, `settings?facilityId=`. Staff lists carry the patient's name and
number, the note count and the response target (`responseDueAt`, `overdue`), never message or note text. Attachment
links: `GET /portal/message-threads/:id/attachments/:documentId/link` (own conversation) and
`GET /patient-messages/:id/attachments/:documentId/link` (`patient.message.read` + `document.read`).

## Events

`PatientMessageSent` (`sender`, `notify`; ids only — a message's text never travels through the outbox). Handled in
`apps/api/src/app/portal/patient-message-notices.ts`, idempotent per event:

- a patient's message → in-app `portal.message-new` to the assigned person; else the person the topic is routed to;
  else the holders of the routed role who can reply; else everyone who can reply (`patient.message.manage`) at the
  patient's facility — once for a run of messages (`notify` is false when the patient wrote last); the notice has no
  name or text and links to the conversation (`PatientMessageNotices.recipientsOf`);
- hourly, `PatientMessageReminders` (API process, advisory-locked) sends in-app `portal.message-overdue` to the same
  people for each conversation past its target, once per target (`overdue_notified_at`); a later patient message
  after a reply sets a new target that can be reminded again;
- the clinic's message → the patient by SMS, or email when SMS is not possible (`portal.message-received`: "you have a
  new message in MyHealth"), with consent and communication preferences applied — never the sender, subject or words.

## Permissions

`patient.message.read` (see the queue, conversations and notes) and `patient.message.manage` (reply, start, assign,
close, reopen, add notes) — granted to org_admin, receptionist, nurse, physician, dentist and records_officer
(migration `0076`); `clinic.configure` for routing and targets; `document.read` as well to open an attachment from
the staff side. The patient side needs a MyHealth session (`PatientAccessGuard`). No new permission in `0097`.

## API

Patient: `GET/POST /portal/message-threads` (`documentIds` optional), `GET /portal/message-threads/unread-count`,
`POST /portal/message-threads/uploads`, `POST …/uploads/:documentId/complete`, `GET /portal/message-threads/:id`,
`POST /portal/message-threads/:id/messages`, `GET …/:id/attachments/:documentId/link`.
Staff: `GET/POST /patient-messages`, `GET /patient-messages/awaiting-count | overdue-count`,
`GET|PUT /patient-messages/settings`, `GET /patient-messages/:id`,
`POST /patient-messages/:id/messages | notes | assignment | close | reopen`, `GET …/:id/attachments/:documentId/link`.

## Audit

Patient: `portal.message-send`, `portal.message-thread-view`, `portal.message-threads-view`. Staff:
`patient.message-reply`, `patient.message-start`, `patient.message-thread-view`, `patient.message-assign`,
`patient.message-close`, `patient.message-reopen`, `patient.message-note`, `patient.message-settings-update`;
uploads and links through the documents platform (`document.create`, `document.upload-complete`,
`document.download`). Audit metadata holds ids, topics and attachment counts, never message or note text.

## Screens

MyHealth `/messages` (conversations above the notices, **New message**), `/messages/new` and `/messages/[threadId]`
(both with **Add a photo or PDF**; files open behind short-lived links). Staff `/messages` (queue with the response
target and note count), `/messages/[threadId]` (attachments, reply with files, **Internal notes**),
`/messages/settings` (routing and targets per topic at the selected facility), and **Message in MyHealth** on the
patient record (starts a conversation) with a link to all conversations with that patient.

## Integration points

Notification platform (in-app to staff; SMS/email to patients), documents platform (patient uploads are
`clinical_attachment` documents of the record; signed links), the staff directory (`UsersService.holdersOfRole` for
routed roles), patient merge (links, not moves), audit. No external system.
