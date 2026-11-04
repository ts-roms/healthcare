# Kiosk and queue management — security, integration and E2E audit (Phase 6)

Date: 2026-11-04 · Scope: `apps/api/src/app/kiosk`, `apps/kiosk`, `tools/kiosk-print-agent`, the staff queue/devices screens, the queue
actions in `libs/clinic`, the realtime gateway's kiosk channels · Status of every finding: **Open** (nothing has been changed; this
report awaits your approval of a remediation plan).

## How this was done, and what it does not cover

- **Code review** of every kiosk controller and service, the DTOs, rules, schema, the kiosk web app's session and cookie handling,
  its headers, the print agent's design, and the realtime channels.
- **Controlled probes** against a local test API and a throwaway test database (a temporary integration spec, run once and then
  deleted; no production system was touched): a parallel guessing burst, concurrent check-ins, concurrent calls, a failing approval,
  injection-looking input, a role/route matrix, and cross-kiosk session use. The results are quoted as evidence below.
- **Existing tests re-read** for what is already proven (integration 1,157 passed; E2E 138 of 139 on the last full run, the one failure
  passing on its own; kiosk 53, staff 396, agent 33 unit tests).
- **Not done:** an OWASP ZAP scan, load testing, a test on a real kiosk, printer or TV, a penetration test of the deployed
  environment, and a run of a browser journey with the network cut. Where a conclusion rests on code reading and not on a run, it
  says so. Nothing here certifies the module as secure.

## Summary

| #     | Severity      | Finding                                                                                                                                  | Evidence       |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| KA-01 | Medium        | The identification limit (3 per session, 9 per kiosk) can be beaten by sending guesses in parallel                                       | Probe P1 (run) |
| KA-02 | Medium        | Approving a registration is not one transaction: a failure after the patient is created leaves an orphan                                 | Probe P6 (run) |
| KA-03 | Low           | A kiosk can overwrite the printer status the print agent reported                                                                        | Probe P9 (run) |
| KA-04 | Low           | Any print-agent account of a facility can claim any of its kiosks' jobs; the agent is not bound to its kiosk codes                       | Code, probe P8 |
| KA-05 | Low           | The shared kiosk session lives past its use: `kiosk_session.patient_id` is kept after the session ends, contradicting the code's comment | Code           |
| KA-06 | Low           | Registration flooding: 50 waiting registrations per kiosk can be reached and block honest ones                                           | Code (not run) |
| KA-07 | Low           | Limits are per network address; kiosks behind one NAT share them                                                                         | Code           |
| KA-08 | Low           | A realtime outage can drop an announcement (only the current state is re-read)                                                           | Code (not run) |
| KA-09 | Informational | No script-src in the kiosk's CSP (same accepted position as staff and portal)                                                            | Code           |
| KA-10 | Informational | Service names appear on the kiosk screen, the printed ticket and the display                                                             | Code           |
| KA-11 | Informational | E2E gaps against the Phase 6 list                                                                                                        | Test inventory |
| KA-12 | Informational | Things that could not be tested here                                                                                                     | —              |

No Critical or High findings. The Medium findings are real but need a valid kiosk device token (KA-01) or a concurrent second
reviewer / invalid input (KA-02), so they are not reachable by an anonymous visitor.

## Findings

### KA-01 — Parallel guesses beat the identification limit (Medium)

- **Evidence.** One session, 30 identification requests with a real patient number and wrong birth dates, sent at once: the session
  recorded **23 failed attempts** against a limit of 3 (answers: 2 × `identification_failed`, 28 × `kiosk_session_locked`). The
  comment in `kiosk-session.service.ts:105` says a miss "is counted before it is answered, so parallel guesses cannot beat the limit";
  the code looks the person up first (`identity.verify`, line 113) and counts only after a miss (line 115), and the per-kiosk
  cooling-down check (line 112) also runs before the lookup, so a burst passes both.
- **Affected.** `apps/api/src/app/kiosk/kiosk-session.service.ts` (`identify`), `kiosk.rules.ts`.
- **Reproduction.** Open a session with a kiosk token; send N concurrent `POST /kiosk/identify` calls with different birth dates for
  one patient number; read `kiosk_session.failed_attempts`.
- **Business impact.** Identification needs a number (or mobile), exact birth date and given name. The design allows 9 guesses per
  kiosk per 10 minutes; a burst allows about the address limit (40 a minute) instead. With a known patient number, the birth date is
  roughly 36,000 possibilities, so this does not make guessing cheap, but it removes the designed ceiling. It requires a kiosk
  device token (a person at the kiosk cannot send parallel requests through the screen), which is why it is Medium, not High.
- **Remediation.** Count the attempt before the lookup and refund it on success, in one atomic statement
  (`UPDATE … SET failed_attempts = failed_attempts + 1 … RETURNING`, refuse when already at the limit), and apply the per-kiosk budget
  the same way. Correct the comment.
- **Regression tests.** A 30-way parallel identify must record at most 3 failures on the session and at most the kiosk budget in
  total; a correct identification after 2 misses still works.

### KA-02 — Approving a registration can leave an orphan patient (Medium)

- **Evidence.** A pending registration approved with an unknown `visitTypeId`: the response was `404 not_found`, the registration
  stayed `pending`, **one patient had been created**, and approving again was refused with `409 possible_duplicates` (the new
  patient is now a duplicate of the submission). `approve` registers the patient and queues the visit first, and closes the
  submission in a separate transaction afterwards (`kiosk-registration.service.ts:224–245`).
- **Affected.** `kiosk-registration.service.ts` (`approve`, `link`, `decide`), the staff review screen.
- **Reproduction.** Approve with an invalid or inactive service, or have two reviewers approve the same registration at once with a
  duplicate override.
- **Business impact.** A patient record exists with no link to the submission; the reviewer is pushed into the duplicate-override
  flow; two reviewers with an override could create two patients. Records are not lost, but the Patient Master gets a duplicate that
  staff must merge.
- **Remediation.** Do the registration, the optional visit and the decision in one transaction (the patient and visit services need to
  accept an outer transaction), or claim the submission first (`pending → deciding`) and release it on failure. Validate the service
  before creating anything.
- **Regression tests.** Approval with a bad service creates no patient and keeps the submission pending; two simultaneous approvals
  create exactly one patient.

### KA-03 — A kiosk can overwrite the printer status (Low)

- **Evidence.** The print agent reported `paper_out`; a kiosk heartbeat with `printerStatus: "ok"` then changed it to `ok`.
- **Affected.** `kiosk.dto.ts` (`heartbeatSchema`), `kiosk-device.service.ts` (`heartbeat`).
- **Impact.** A faulty or tampered kiosk app can hide a printer problem from staff (the devices page then shows the printer working).
- **Remediation.** The kiosk should not report printer state at all (the agent does); drop the field from the kiosk heartbeat or accept
  only `none`.
- **Regression test.** A kiosk heartbeat never changes `printer_status` after an agent report.

### KA-04 — The print agent is not bound to its kiosk (Low)

- **Evidence.** `deviceByCode` checks only the agent's facility; any account holding `kiosk.print.agent` at the facility may claim jobs
  for, or report the printer of, any kiosk there by naming its code. A kiosk, display or receptionist token is refused (probe P8: 403 on
  all agent routes; the agent token is refused on all kiosk, queue and patient routes).
- **Impact.** Limited: jobs hold a ticket number, service name, facility name, time and a fixed instruction, never a patient. A second
  agent could take another kiosk's tickets and print them elsewhere.
- **Remediation.** Optional: record which device codes an agent account may serve (a column or a table), checked in `deviceByCode`.
- **Regression test.** An agent bound to kiosk A gets 404 for kiosk B.

### KA-05 — The session keeps the patient after it ends (Low)

- **Evidence.** `end()` and the expiry job only set the status; `kiosk_session.patient_id` stays. The service comment says "nothing
  about them stays on the session".
- **Impact.** The row links a kiosk visit to a patient indefinitely. That is useful for the audit trail, but it is a retention fact the
  organization has not decided, and the comment is wrong.
- **Remediation.** Decide with the organization: keep (document it, add to the retention register) or clear `patient_id` when the
  session ends (the audit event already records the patient). Fix the comment either way.

### KA-06 — Registration flooding (Low, not executed)

- A kiosk token can open sessions (60 a minute per address) and submit registrations (20 a minute; one per session) until
  `MAX_PENDING_PER_DEVICE = 50` is reached; then honest people at that kiosk are told to see the desk until reception decides or 24
  hours pass. Each waiting item stores a sealed payload (sealed, size-bounded by the schema).
- **Remediation.** An alert or badge threshold for a growing backlog, a per-kiosk hourly cap lower than 50, and a staff action to reject
  in bulk.

### KA-07 — Limits are per network address (Low)

- The throttles (60 sessions, 40 identifications, 20 registrations a minute) count by address; kiosks behind one NAT share them, and one
  noisy kiosk can lock the others out for a minute. The comments say so. Counters are in Redis and shared by replicas.
- **Remediation.** Key the throttle by device (the access token's subject) as well as by address.

### KA-08 — A realtime outage can drop an announcement (Low, not executed)

- The waiting-room display is driven by the realtime channel with a 15-second re-read. If the socket is down and two calls happen
  within one poll interval, the first is never announced (the board still shows it under "earlier calls"). Duplicate announcements are
  prevented (one call key announced once; recalls get a new key; unit-tested in `announcement-queue.test.ts`).
- Registrations use the same pattern; the event carries no detail and the list re-reads on any event or poll.
- There is no "Call next" endpoint: reception calls a chosen ticket, version-checked, so two receptionists cannot call the same ticket
  twice (probe P5: one `200`, one `409 version_conflict`).
- **Remediation.** Optional: the display could request calls since its last seen call time, not only the current state.

### KA-09 — No script-src policy (Informational)

- The kiosk sets frame-ancestors none, X-Frame-Options DENY, nosniff, no-referrer, a restrictive Permissions-Policy and `no-store`.
  There is no `script-src`, because Next.js writes inline scripts; the staff and portal apps record the same decision (VR-23). No
  `dangerouslySetInnerHTML` exists in the kiosk or the queue screens, so no XSS sink was found by search, and every API call is made
  from server actions with httpOnly, SameSite=Strict cookies. A nonce-based policy would be the next step.

### KA-10 — Service names are shown to bystanders (Informational)

- The service name appears on the kiosk screen, the printed ticket and the display's department grouping. The organization chooses
  which services are kiosk-enabled; naming a service after a sensitive condition would expose it. Add this to the organization's
  set-up guidance.

### KA-11 — E2E coverage against the Phase 6 list (Informational)

Covered in a browser: new-patient registration, reception review, duplicate handling, existing patient walk-in ticket, recall / no-show /
put back in line, printing and printer failure recovery with a reprint, the display's branding and grouping, live registration list,
idle/Start over, browser-storage cleanliness, security headers.
Covered only in integration tests (not in a browser): appointment check-in at the kiosk, session expiry, multi-kiosk concurrency, call
conflicts.
Not covered: network interruption and recovery on the kiosk screen, the voice announcement (unit-tested only), the display updating when
a receptionist calls a ticket (the earlier queue journeys cover the call; the display screen itself is not asserted), queue completion and
transfer between counters from a kiosk ticket, and a full multi-counter run with several browsers.

### KA-12 — Not testable here (Informational)

A real printer, kiosk, touch screen, TV, speakers and the Filipino/English voices; ZAP; load and soak tests; the print agent running as an
operating-system service; the production network layout (firewalling the printer, TLS); backup and restore of the kiosk tables.

## Controls checked and found working

- **Authentication / device identity.** A kiosk is its own signed-in staff account; the code in the address is only routing. Registration
  refuses accounts that can read patients (`kiosk_account_too_powerful`).
- **Authorization matrix (probe P8).** A kiosk token is refused on the agent, display, print-job and staff routes; the agent token on
  the kiosk, queue and patient routes; a display token on the kiosk and agent routes; a receptionist on the kiosk and agent routes.
- **IDOR.** A session token from one kiosk used on another gives the same "session ended" answer as an unknown token (probe P10); print
  status is scoped to the kiosk's own jobs; registrations are scoped by organization and facility.
- **Injection.** Quote- and wildcard-bearing input to identification answered a normal 422 / 400 and the patient table was intact (probe
  P7); all queries are parameterized through Drizzle.
- **Concurrency.** Two kiosks checking in the same patient at once produced one visit and one `409 already_in_queue` (P2); five parallel
  check-ins in one session produced one visit and one print job (P3); a retried check-in with the same `Idempotency-Key` returned the
  same ticket (P12); the ticket number is unique per facility and day by constraint (`UNIQUE (facility_id, queue_date, queue_number)`);
  concurrent calls are version-checked (P5).
- **Data exposure.** Identification answers initials and birth year only and answers every miss alike; registrations are sealed with the
  integration key ring and erased on decision or after 24 hours; the print job and the display carry no patient name, number or reason.
- **Audit.** Session open, identification (success and denial), registration submit/view/decision with the identity-check record, print
  failure, reprint with a reason, visit creation and device changes are audited in the same transaction; the audit table is append-only.
- **Printer agent design.** Pull-only, no job-accepting port, health on 127.0.0.1, https required, private-network printers only, every
  text reduced to printable ASCII before it reaches the printer, its own account holding one permission.

## Proposed remediation order (for your approval)

1. KA-01 (atomic attempt counting) and KA-02 (atomic approval) — each with regression tests listed above.
2. KA-03 and KA-05 — small changes, one migration at most (clearing `patient_id`, if you choose that).
3. KA-04, KA-07 — hardening, optional.
4. KA-06, KA-08, KA-09 — design decisions for you.
5. KA-11 — add browser journeys for the missing cases (network interruption, display update on call, appointment check-in).
6. KA-12 — a hardware and environment test plan to run on the target devices, and the ZAP scan against a staging copy.

After approval, I will fix in that order, re-run lint, typecheck, unit, integration and E2E, and issue a final report. No finding will be
marked Verified Fixed without a retest.
