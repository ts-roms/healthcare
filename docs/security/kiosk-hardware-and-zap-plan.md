# Kiosk — hardware, environment and ZAP test plan

Companion to [the Phase 6 audit report](kiosk-audit-phase-6.md) (findings KA-12 and the "not testable here" list). Nothing in this plan
has been run: it needs a real kiosk, printer, display and a staging copy that does not exist yet. A box is ticked only by the person who
did the check, with the date and what they saw. Nothing here may be run against production, and no real patient data is used anywhere.

## Part A — Hardware and environment checks

Do these on the **target devices** at a **staging copy** of the clinic (own database, own accounts, test patients such as "Test
Kioskuser"). Record the model of every device and the app version (`Queue → Devices` shows it).

### A1. The kiosk (touch screen)

| #     | Check                                                                                                         | Expect                                                                                      | Done |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| A1.1  | Power on cold; the browser opens the kiosk address in full-screen kiosk mode                                  | Welcome screen without a tap, no browser bars, no way to leave the page by touch            |      |
| A1.2  | Sign the device in once at `/setup` with the kiosk account (not a person's account)                           | Welcome screen; **Queue → Devices** shows it online within a minute                         |      |
| A1.3  | Touch targets with real fingers, including a gloved or wet finger and a child's reach                         | Every button reachable and hit on the first try; nothing needs a double tap                 |      |
| A1.4  | The on-screen keyboard (the device's own) while filling the identification and registration forms             | Fields stay visible above the keyboard; typing numbers brings the number pad where expected |      |
| A1.5  | Glare and distance: read the screen from 1 m in the room's real lighting                                      | Text and buttons readable; error and success states distinguishable without colour          |      |
| A1.6  | Walk away mid-way at each step                                                                                | Screen returns to Welcome after about 2 idle minutes, nothing of the last person visible    |      |
| A1.7  | Press the browser/OS shortcuts a visitor might try (back, refresh, long-press, right-click, drag, pinch zoom) | Nothing exposes the previous person, the address bar or the operating system                |      |
| A1.8  | Pull the network cable (or turn Wi-Fi off) while someone is typing, then restore it                           | Plain "see the front desk" words, never a blank or frozen screen; works again by itself     |      |
| A1.9  | Power cut and restart mid-session                                                                             | Comes back to Welcome signed in; the old person's session is not resumable                  |      |
| A1.10 | Leave it running for 24 hours, then 7 days                                                                    | Still responsive; no memory growth that slows it; heartbeat never goes offline              |      |
| A1.11 | Browser storage after a full visit (open the browser's developer tools on a service machine)                  | No patient data in local/session storage or cookies readable by scripts                     |      |
| A1.12 | Cleaning: wipe the screen with the clinic's usual cleaner                                                     | No accidental taps register as input for more than a moment                                 |      |

### A2. The ticket printer and the print agent

Follow the runbook's [Check it on the real printer](../runbooks/kiosk-print-agent.md) first; then:

| #    | Check                                                                                               | Expect                                                                                                                                                     | Done |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A2.1 | Printer model and paper width (80 mm or 58 mm), code page, cutter                                   | Recorded; ticket text fits the width (48 or 32 columns), the number is large and readable                                                                  |      |
| A2.2 | Print 50 tickets in a row                                                                           | None missing, none duplicated, none cut off; time per ticket recorded                                                                                      |      |
| A2.3 | Paper out, cover open, paper jam, cable unplugged, printer powered off — one at a time              | Kiosk tells the person to see the desk; **Devices** shows "needs attention" (note which causes the model does not report); printing again works once fixed |      |
| A2.4 | Kill the agent while a ticket is printing, then restart it                                          | At most one extra copy; record what actually happened (the audit report names this as a known weakness)                                                    |      |
| A2.5 | Two kiosks sharing one printer, checking in at the same moment                                      | Each ticket printed once with its own number                                                                                                               |      |
| A2.6 | Agent machine reboot                                                                                | Agent starts by itself as a service; health at `http://127.0.0.1:8788/health` answers; first ticket prints                                                 |      |
| A2.7 | Try to reach the agent's health port and the printer's port from another machine and from the kiosk | Health port refused from elsewhere; the printer's raw port is reachable only from the agent machine's network segment                                      |      |
| A2.8 | Bind the agent to its kiosk (**Edit → Print agent**) and start a second agent account               | The second agent cannot claim that kiosk's tickets                                                                                                         |      |
| A2.9 | Name a service with accented or non-ASCII letters                                                   | Ticket prints with plain letters (known limit: ASCII only); record what the clinic wants                                                                   |      |

### A3. The waiting-room display and sound

| #     | Check                                                                                                  | Expect                                                                                                             | Done |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---- |
| A3.1  | Open `/display/queue` on the TV's browser or media box with the display account; full screen           | Headline, footer and colour as the clinic set them; readable from the back of the room                             |      |
| A3.2  | Overscan and resolution (1080p and 4K, 16:9)                                                           | Nothing cut off at the edges; text not tiny                                                                        |      |
| A3.3  | Call a ticket at the desk                                                                              | Appears within a second with the chime; the earlier call moves to "recent"                                         |      |
| A3.4  | Turn sound on at the screen (needs one click), test volume at low/normal/loud in the real room         | Audible at the farthest seat without being startling; level setting remembered after reload                        |      |
| A3.5  | Voices: English, Filipino, both — listen to a ticket spelled out ("A, zero, zero, seven") and the room | Clear, correct, natural enough; note the voice names present on that device                                        |      |
| A3.6  | A device with no Filipino voice installed                                                              | Falls back or says so visibly; "audio failure" notice appears; chime still plays                                   |      |
| A3.7  | Three calls within a few seconds, then two calls while the network is cut for 20 seconds               | Announced one at a time, oldest first, none repeated; after the network returns the missed call is still announced |      |
| A3.8  | Recall a ticket                                                                                        | Announced again (new call); not announced twice                                                                    |      |
| A3.9  | Sleep and screensaver behaviour; unplug the network for 10 minutes and restore                         | Stays awake; shows a live/offline state honestly; recovers without a keyboard                                      |      |
| A3.10 | The display's heartbeat                                                                                | **Devices** shows it online; turning it off shows "Not reporting" within two minutes                               |      |
| A3.11 | Privacy: stand where the public stands                                                                 | Only ticket numbers and places; no name, patient number, visit type or reason anywhere                             |      |

### A4. Network, power and environment

| #    | Check                                                                                                            | Expect                                                                                                | Done |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- |
| A4.1 | Kiosk, display and agent each on their own network name or VLAN; printer reachable only by the agent             | Documented in a diagram; a visitor's phone on guest Wi-Fi cannot reach any of them                    |      |
| A4.2 | Only https to the API is allowed out of the kiosk's segment; time is synchronised                                | Verified in the router; wrong clock does not break sign-in                                            |      |
| A4.3 | Internet outage of 10 minutes, then 1 hour                                                                       | Kiosk shows plain words and recovers; the desk keeps working on the staff app's offline mode          |      |
| A4.4 | Surge/brown-out and UPS behaviour for kiosk, printer and agent machine                                           | Orderly restart; no corrupted ticket numbering                                                        |      |
| A4.5 | Physical security: the kiosk cabinet, USB ports, power and network sockets                                       | Not accessible to visitors; a locked cabinet or covered ports                                         |      |
| A4.6 | Accessibility walk-through with the clinic's staff: wheelchair reach height, low vision, hearing, one-handed use | Results recorded; gaps listed for the clinic to decide (the platform does not claim a standard)       |      |
| A4.7 | Real queue day: one morning with the kiosk beside the normal desk                                                | Counts of check-ins, abandoned screens, "see the desk" messages, reprints; staff and patient comments |      |

Record unexpected results in `docs/security/kiosk-audit-phase-6.md` as new findings (severity, evidence, steps), not in this table.

## Part B — OWASP ZAP scan plan

### B1. Ground rules

- **Staging only.** A separate copy of the stack (API, kiosk app, staff app, PostgreSQL, Redis, object storage) with its own database
  and test data. Never production, never a shared database, never a real patient.
- **Written go-ahead** from whoever owns the staging environment, and a time window. A scan sends many requests and can fill the
  audit table, queue print jobs and lock accounts; those effects are expected there.
- **Rate limits will bite.** Run the scan with the staging copy's rate-limit storage on its own Redis, expect `429` answers, and never
  switch the limits off for a "cleaner" result: that would hide what the scan is meant to find. Record where limits stop the scan.
- **Reports hold no secrets.** Use throwaway accounts whose passwords are rotated after the scan; never paste a token or password into
  a report, a ticket or this repository.
- **No destructive modes.** Baseline (passive) and API scans first; an active scan only against staging, only on the routes listed below.

### B2. Set-up

1. A staging stack built from the release candidate commit; note the commit and the date in the report.
2. Test accounts (all throwaway): a kiosk account (role Patient kiosk, registered as a device), a print-agent account, a display
   account, a receptionist, a records officer / org admin, and one test patient with an appointment today.
3. Run ZAP from the official container image (the current stable tag, pinned in the report), on a machine that can reach staging:

   ```bash
   docker run --rm -v "$PWD/zap-out:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://kiosk.staging.example/setup -r kiosk-baseline.html -J kiosk-baseline.json
   ```

   Replace the address with the staging kiosk URL; `-m 5` limits the spider minutes. Run the same for the staff app login and the
   waiting-room display address, one report each.

4. The API scan uses the OpenAPI document the API serves (`/api/docs`; the JSON document is linked from that page, or exported with
   Swagger's usual `-json` path if enabled) and a **bearer token** from a test account, supplied to ZAP as a header replacer rule,
   not written into the command line or any file in the repository:

   ```bash
   docker run --rm -v "$PWD/zap-out:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py -t https://api.staging.example/api/docs-json -f openapi -r api-kiosk.html -J api-kiosk.json -z "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization -config replacer.full_list(0).replacement=<set at run time from a secret store>"
   ```

   Run it once per role (kiosk, print agent, display, receptionist, records officer) so that each role's allowed and refused routes are
   exercised. The kiosk routes also need `X-Kiosk-Session`, which a scan cannot obtain by itself: open a session by hand first and give
   that token the same way (it expires in 15 minutes).

### B3. What to look for, tied to the audit

| Area                     | Specifically check                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers (kiosk, display) | The nonce policy is present on every page and different each request; framing refused; no cache of patient pages; HSTS on https                 |
| Session handling         | Cookies httpOnly, Secure, SameSite=Strict; a kiosk session token from kiosk A is refused on kiosk B (the cross-kiosk check in the audit report) |
| Authentication / access  | Each role gets 403 on the other roles' routes (the matrix in the audit report) — compare ZAP's per-role results to it                           |
| Injection                | Identification fields, registration fields, `printJobs` filters and path ids with quotes, wildcards and very long strings                       |
| Rate limiting            | Identification and registration bursts: the attempt limits (3 per session, 9 per kiosk) and the hourly registration cap hold                    |
| Information exposure     | Error bodies carry a code and a request id only; no stack traces, SQL, file paths or version banners; misses all answer alike                   |
| Realtime                 | The socket refuses a connection without a valid ticket; a kiosk or display account receives only its own channels                               |
| Print agent API          | Claim, result and heartbeat refuse other agents' kiosks when the kiosk names its agent; payloads contain no patient detail                      |
| File and storage         | Nothing from the kiosk app reaches object storage; no directory listing; source maps absent in production builds                                |
| TLS and headers (API)    | Modern TLS only; no mixed content; CORS not wider than the apps' origins                                                                        |

### B4. After the scan

- Triage every alert: **confirmed** (reproduce by hand and write steps), **false positive** (say why), **accepted** (with the owner of the
  risk). Put confirmed ones in the audit report as new findings with severity, evidence and a regression test requirement.
- Keep the JSON/HTML reports in a private place (they contain addresses and request samples), not in the repository.
- Re-run the same scan after fixes and attach the second result; only then may a finding be Verified Fixed.
- Repeat before each release that changes the kiosk, its API routes or its headers.

## Part C — Sign-off

| Item                                   | Who                     | Date | Result |
| -------------------------------------- | ----------------------- | ---- | ------ |
| Part A completed on the target devices | Facility administrator  |      |        |
| Part B baseline and API scans reviewed | Security reviewer       |      |        |
| New findings entered in the audit      | Security reviewer       |      |        |
| Compliance items still open            | Data protection officer |      |        |

Compliance items (privacy notice wording, retention of kiosk sessions and print history, what a kiosk may collect) stay in
[the compliance register](compliance-dependencies.md); a passing technical test does not settle them.
