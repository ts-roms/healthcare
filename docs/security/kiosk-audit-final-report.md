# Kiosk and queue management — final audit report (Phase 6)

Date: 2026-11-04 · Scope: the patient self-service kiosk, queue actions, ticket printing and print agent, the waiting-room display, and
their API, staff screens and tests · Read with [the audit report](kiosk-audit-phase-6.md) (findings in full: evidence, impact, steps) and
[the hardware and ZAP plan](kiosk-hardware-and-zap-plan.md).

## Bottom line

The audit found no Critical or High issue. It found 16 findings: 2 Medium, 10 Low and 4 Informational (the last two, KA-15 and KA-16, were found afterwards: setting up a device, and the voice journey). After your approval of the
remediation plan, every finding that code could fix has been fixed and has a regression test; those fixes are **Fixed - Pending
Verification**, not Verified Fixed, because they have not been retested on the real devices or in a staging environment. This report
does not say the kiosk is secure: it says what was examined, what was changed, what the tests show, and what has not been tested.

## What was done

| Step                                   | Result                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code review                            | Every kiosk controller and service, the DTOs, rules and schema; the kiosk app's session, cookies and headers; the print agent's design; the realtime channels |
| Controlled probes (local test stack)   | Parallel guessing, concurrent check-ins, concurrent calls, a failing approval, injection-looking input, a role/route matrix, cross-kiosk session use          |
| Remediation, in the approved order     | KA-01, 02, 03, 05, then 04, 07, then 06, 08, 09; KA-13 and KA-14 were found and fixed along the way                                                           |
| Browser journeys added                 | Appointment check-in; a lost response; a dropped connection and recovery (`29-kiosk-resilience.journey.ts`)                                                   |
| Test plan for what could not be tested | Hardware, environment and ZAP (`kiosk-hardware-and-zap-plan.md`) — written, not run                                                                           |

## Findings and their status

Status words: **Fixed - Pending Verification** (fix in place, regression test passes, not retested outside the test stack),
**Accepted Risk**, **Open**. Nothing is **Verified Fixed**.

| #     | Severity      | Finding                                                                                                     | Status                                       | Change                                                                                                                                                                                                                         | Regression test                                                                                          |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| KA-01 | Medium        | Parallel guesses beat the 3-attempt identification limit                                                    | Fixed - Pending Verification                 | Each attempt reserved atomically before the lookup, given back on success; kiosk budget counted the same way                                                                                                                   | `kiosk.int.spec.ts` "KA-01" (30 parallel guesses record exactly 3 failures; 2 misses then success works) |
| KA-02 | Medium        | Approving a registration could leave an orphan patient                                                      | Fixed - Pending Verification                 | Migration `0141` reviewer claim; a patient who cannot be queued is still linked to the submission (`queued: false`); a refused approval releases the claim                                                                     | "KA-02" tests (no orphan; two reviewers create one patient; claim released)                              |
| KA-03 | Low           | A kiosk could overwrite the printer status the agent reported                                               | Fixed - Pending Verification                 | Kiosk heartbeat carries the app version only                                                                                                                                                                                   | "KA-03" test                                                                                             |
| KA-04 | Low           | Any print agent of a facility could serve any of its kiosks                                                 | Fixed - Pending Verification                 | Migration `0142`: a kiosk may name its agent account; others get "not found"; unnamed kiosks as before                                                                                                                         | `kiosk-printing.int.spec.ts` "a kiosk's own print agent"                                                 |
| KA-05 | Low           | The session keeps the patient id after it ends                                                              | Accepted Risk (confirmed 2026-11-05)         | Kept as the record of who was served; comment corrected; retention question added to the compliance register                                                                                                                   | —                                                                                                        |
| KA-06 | Low           | Registration flooding                                                                                       | Fixed - Pending Verification                 | 20 registrations an hour per kiosk on top of 50 waiting (`kiosk_registration_busy`)                                                                                                                                            | "KA-06" test (the 21st refused; another kiosk unaffected)                                                |
| KA-07 | Low           | Limits counted per address, shared by kiosks                                                                | Fixed - Pending Verification                 | `DeviceRateLimitGuard` on the kiosk controllers counts per signed-in device account                                                                                                                                            | `kiosk-rate-limit.int.spec.ts`                                                                           |
| KA-08 | Low           | A realtime outage could drop an announcement                                                                | Fixed - Pending Verification                 | The display announces every call since the one it last showed, oldest first (`callsSince`)                                                                                                                                     | `queue-display.test.ts` (missed-call cases)                                                              |
| KA-09 | Informational | No script-src policy on the kiosk                                                                           | Fixed - Pending Verification                 | Per-request nonce policy for the kiosk app (`csp.ts`, `proxy.ts`); staff and portal unchanged                                                                                                                                  | `csp.test.ts`; journey 27 header test; every kiosk journey runs under it                                 |
| KA-10 | Informational | Service names appear on screen, ticket and display                                                          | Fixed - Pending Verification (documentation) | The kiosk set-up guide in the Help manual tells administrators to give kiosk services neutral names                                                                                                                            | —                                                                                                        |
| KA-11 | Informational | E2E gaps against the Phase 6 list                                                                           | Fixed - Pending Verification                 | Journeys 29 and 33 added: appointment check-in, a lost response, a dropped connection, queue transfer from a kiosk ticket, two counters calling together read out in both languages. Journey 33 found a gap, fixed under KA-16 | Journeys 27, 28, 29, 33                                                                                  |
| KA-12 | Informational | Things that could not be tested here                                                                        | Open                                         | Plan written, not run                                                                                                                                                                                                          | —                                                                                                        |
| KA-13 | Low           | The kiosk screen could wait forever on a call that never came back                                          | Fixed - Pending Verification                 | Every kiosk server call goes through `safely()`                                                                                                                                                                                | `safe-action.test.ts`; journey 29 (failed before the fix, passes after)                                  |
| KA-14 | Low           | The print agent could block itself by exceeding its own rate limit                                          | Fixed - Pending Verification                 | Agent ceiling 600 a minute; after a refused sign-in the agent waits for `Retry-After` (30 s default, 2 min at most)                                                                                                            | `api.spec.ts` (agent) backoff test; journey 28 steadier                                                  |
| KA-15 | Low           | No staff screen offered a service at the kiosk (found when setting up a device)                             | Fixed - Pending Verification                 | **Patient kiosk** column and add-form option on the visit types screen                                                                                                                                                         | Journey 29 "offers a service at the kiosk"                                                               |
| KA-16 | Low           | A screen with no earlier call read out only the newest of two calls arriving together (found by journey 33) | Fixed - Pending Verification                 | `callsSince` announces calls from the last 30 seconds when nothing was shown before; unit and journey tests                                                                                                                    | Journey 33, `queue-display.test.ts`                                                                      |

Also fixed during this work, before the audit: a kiosk without a printer showed "Printing your ticket…" and then "could not print".
Each kiosk now has a **Prints tickets** setting, off until staff turn it on (migration `0140`).

## Evidence from the last full runs

| Run                                  | Result                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Full API integration suite           | Passed (`api:integration`, about 33 minutes), including the kiosk specs and the new regression tests |
| Full end-to-end suite (Playwright)   | 143 passed, 0 failed                                                                                 |
| Lint, typecheck                      | Passed for api, staff, kiosk, e2e, print agent                                                       |
| Unit tests (staff, kiosk app, agent) | Passed                                                                                               |

The migrations added are `0140` to `0142`. The commits are `2bce2a81` (prints tickets), `a648f611` (KA-01, 02, 03, 05), `6c8acae1`
(KA-04, 07), `efc9b7c5` (KA-13, journeys), `40ba7178` (KA-14), `337c6473` (KA-06, 08, 09), and the two plan/report commits.

## A flaky journey, and how sure we are

The printing journey failed in some full runs earlier in this work (a ticket stayed queued with no attempt at all) and passed when run
alone. The mechanism found (the agent exceeding its own rate limit, and retrying a refused sign-in on every poll) fits the evidence in
the print-job table, and was fixed (KA-14). The two full runs since then, which include both changes, passed. A failure that showed in
only some runs cannot be proven gone by a few clean runs: if it returns, the journey now prints the agent's health report with the
failure.

## What has not been tested (and is therefore not claimed)

- Any real kiosk, touch screen, printer, television, speaker or voice; the checks are in the plan, Part A.
- An OWASP ZAP scan, load testing, and a penetration test of a deployed environment; Part B of the plan.
- Backup and restore of the kiosk tables, and the print agent running as an operating-system service.
- The voice announcement in a browser journey (it is unit-tested only), and queue transfer between counters from a kiosk ticket.
- Known limits from the earlier phase review, not audit findings: a print agent that crashes between printing and reporting can print
  one ticket twice (its memory of printed tickets is in-process only); a print slower than the 30-second lease could be repeated by a
  second agent; ticket text is plain ASCII only; the agent runs from the repository, not as a packaged install; the devices page does
  not refresh by itself; Filipino wording is not on the kiosk screen itself.

## Open decisions for you

1. ~~KA-05~~ — decided: the patient id stays on the session (confirmed 2026-11-05). The retention period for it remains a question for the organization in the compliance register.
2. **KA-10** — whether to add a line of set-up guidance to the user manual about naming kiosk services.
3. **Compliance items** in [the compliance register](compliance-dependencies.md) that stay with the organization: the privacy notice
   wording, how long kiosk sessions and print history are kept, what a kiosk may collect, and who may check in a minor.

## Next steps

1. Run the hardware and ZAP plan on a staging copy and the target devices; record new findings in the audit report.
2. Retest each "Fixed - Pending Verification" item there; only then change it to Verified Fixed.
3. Add the remaining browser journeys (voice announcement, queue transfer, several browsers at once).
4. Repeat the ZAP scan before each release that touches the kiosk, its routes or its headers.
