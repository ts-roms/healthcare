# Patient messaging (MyHealth conversations)

## Purpose

A patient and the clinic write to each other in conversations, inside MyHealth. It replaces "call the clinic" for
non-urgent questions and lets the clinic ask a patient something and get an answer. It is **not** an emergency
channel, is **not** watched in real time, carries **text only** (no photos or documents), and is **not** a place to
release results or give urgent instructions. MyHealth says so wherever a patient writes, and staff screens repeat it.
Care advice given in a reply is the clinician's own; nothing here decides or suggests anything clinically.

Not built: attachments, staff-only internal notes, routing rules by topic or staff role, service-level targets or
overdue alerts beyond showing how long a conversation has waited, auto-replies, canned answers.

## Entities

- `patient_message_thread` — one conversation: `patient_id`, `facility_id` (where the patient is registered: the
  clinic it is routed to), `topic` (`general | appointment | results | medication | billing | other`), `subject`
  (≤ 100), `started_by` (`patient | staff`), `status` (`open | closed`), `assigned_to`, `message_count`,
  `last_message_at` / `last_message_from`, `patient_read_through` (the clinic's messages the patient has read),
  `closed_at` / `closed_by`, `version`. Migration `0076`.
- `patient_message` — append-only (`prevent_mutation` trigger): `sender_type`, exactly one of
  `sender_portal_account_id` (the patient's MyHealth account) or `sender_user_id` (staff), `body` (1–2,000).
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
conversation, `awaiting-count`. Staff lists carry the patient's name and number, never message text.

## Events

`PatientMessageSent` (`sender`, `notify`; ids only — a message's text never travels through the outbox). Handled in
`apps/api/src/app/portal/patient-message-notices.ts`, idempotent per event:

- a patient's message → in-app `portal.message-new` to the assigned person, or to everyone who can reply
  (`patient.message.manage`) at the patient's facility — once for a run of messages (`notify` is false when the
  patient wrote last); the notice has no name or text and links to the conversation;
- the clinic's message → the patient by SMS, or email when SMS is not possible (`portal.message-received`: "you have a
  new message in MyHealth"), with consent and communication preferences applied — never the sender, subject or words.

## Permissions

`patient.message.read` (see the queue and conversations) and `patient.message.manage` (reply, start, assign, close,
reopen) — granted to org_admin, receptionist, nurse, physician, dentist and records_officer (migration `0076`). The
patient side needs a MyHealth session (`PatientAccessGuard`).

## API

Patient: `GET/POST /portal/message-threads`, `GET /portal/message-threads/unread-count`,
`GET /portal/message-threads/:id`, `POST /portal/message-threads/:id/messages`.
Staff: `GET/POST /patient-messages`, `GET /patient-messages/awaiting-count`, `GET /patient-messages/:id`,
`POST /patient-messages/:id/messages | assignment | close | reopen`.

## Audit

Patient: `portal.message-send`, `portal.message-thread-view`, `portal.message-threads-view`. Staff:
`patient.message-reply`, `patient.message-start`, `patient.message-thread-view`, `patient.message-assign`,
`patient.message-close`, `patient.message-reopen`. Audit metadata holds ids and topics, never message text.

## Screens

MyHealth `/messages` (conversations above the notices, **New message**), `/messages/new`, `/messages/[threadId]`.
Staff `/messages` (queue), `/messages/[threadId]`, and **Message in MyHealth** on the patient record (starts a
conversation) with a link to all conversations with that patient.

## Integration points

Notification platform (in-app to staff; SMS/email to patients), patient merge (links, not moves), audit. No external
system.
