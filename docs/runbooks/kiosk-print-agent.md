# Kiosk print agent — set-up and operation

The print agent (`tools/kiosk-print-agent`) prints the queue tickets that patient kiosks issue. It runs on a machine in the
clinic next to the printer. **It has been tested against a simulated API and printers, never against a real printer** —
follow "Check it on the real printer" below before relying on it.

## How it works, in one paragraph

A kiosk check-in queues a ticket job on the server (the ticket number, the service, the facility, the time and a plain
instruction — never a patient). The agent signs in to the API as its own account, asks for the next job of its kiosk every
couple of seconds, prints it and reports the result. It **only pulls**: it opens no port for jobs, only a read-only health
check on `127.0.0.1`. It reports its printer's state (ok, paper out, offline, error) about every 30 seconds so staff see
whether the printer works (staff **Queue → Devices**).

## Before you start

1. A kiosk registered at the facility (**Queue → Devices**, or `POST /kiosk/admin/devices`).
2. A staff account for the agent: **Administration → Users**, role **Kiosk print agent** at the kiosk's facility, and nothing
   else. If your organization requires two-step verification, exempt this account with a reason (the agent signs in with a
   password only). Use a long random password; the account can claim ticket jobs and report printer state and can open no
   patient record.
3. The printer: an 80 mm or 58 mm ESC/POS thermal printer. Reached over the clinic's network (raw port, normally 9100) or
   through the operating system (a device file such as `/dev/usb/lp0`, or a shared raw queue such as `\\localhost\TicketPrinter`
   on Windows). Direct USB drivers are not included. Give a network printer a fixed address on the clinic's own network.
4. Node 22 on the machine, and a copy of this repository (or a build of the tool).

## Where the settings live

**In the staff app** (**Queue → Devices → Edit** on the kiosk, an administrator with `kiosk.device.manage`): whether the kiosk **Prints tickets**,
which **Print agent** serves it, and its **Printer** section:

| Setting                   | Meaning                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Where is the printer?** | **On the clinic's network** (an address and a port) or **Connected to the agent's computer** (which printer that is, is set on that computer).     |
| **Printer address**       | For a network printer: an address on the clinic's own network (such as `192.168.1.50`) or a local name. A public address is refused when you save. |
| **Port**                  | For a network printer; normally 9100 (left empty it is 9100).                                                                                      |
| **Paper width**           | **80 mm** (48 characters a line) or **58 mm** (32).                                                                                                |

The agent reads these about once a minute, so a change needs **nothing** done on the agent's computer: no restart, no edit. Kiosks that share a printer
are served together.

**On the agent's computer** (environment variables) only how it reaches and signs in to the API, and the printer connected to that computer if there is one:

| Variable                             | Meaning                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`                       | The API address including `/api/v1`. **https is required**; http is accepted only for `localhost`.                                                                                                            |
| `AGENT_EMAIL`, `AGENT_PASSWORD_FILE` | The agent's account. Prefer a file holding the password (readable only by the agent's service account); `AGENT_PASSWORD` is accepted but shows in listings.                                                   |
| `ORGANIZATION_ID`                    | Only if the account belongs to several organizations.                                                                                                                                                         |
| `FACILITY_ID`                        | Optional. The agent finds its facility itself when its account holds a role at exactly one; set it when the account works at several.                                                                         |
| `DEVICE_CODES`                       | Optional. Serve only these kiosks (comma-separated). Without it the agent serves every kiosk of its facility that prints tickets.                                                                             |
| `PRINTER_TYPE`                       | Only for kiosks set to "Connected to the agent's computer": `file` (operating-system path), `tcp` (a network printer for those kiosks) or `dryrun` (write tickets to a folder, no printer).                   |
| `PRINTER_PATH`                       | For `file`: a device file (`/dev/usb/lp0`) or a shared raw queue (`\\localhost\TicketPrinter`). It is set here, not in the staff app, because a path on a machine is not something to change from a web page. |
| `PRINTER_HOST`, `PRINTER_PORT`       | For `tcp`. The host must be on the clinic's own network (a private address, or a name ending `.local`/`.lan`, or a single-word name). Port default 9100.                                                      |
| `DRYRUN_DIR`                         | For `dryrun` (default `./printed`).                                                                                                                                                                           |
| `TIMEZONE`                           | Optional: the time zone for the time on the ticket. Without it the facility's own time zone is used.                                                                                                          |
| `POLL_MS`, `HEARTBEAT_MS`            | How often it asks for tickets (default 2000) and reports the printer (default 30000).                                                                                                                         |
| `CONFIG_REFRESH_MS`                  | How often it asks for changed printer settings (default 60000).                                                                                                                                               |
| `HEALTH_PORT`                        | The local health port (default 8788, `127.0.0.1` only).                                                                                                                                                       |

The agent refuses to start, and says why, when a setting is wrong (an http address that is not local, a local printer outside the clinic's network, no
password, an unknown time zone). It also refuses, with a line in its log, to print to an address outside the clinic's network that the staff app gave it.
The paper width (formerly `PAPER_MM`) is set in the staff app.

## Run it

```bash
pnpm kiosk:print-agent        # from the repository root
```

Run it as a service so it starts with the machine and restarts if it stops (a Windows service through the Task Scheduler or
NSSM, or `systemd` on Linux), as an ordinary user with no administrator rights, with the settings in the service's
environment. It writes one JSON line per event to its output (`agent.started`, `agent.printed`, `agent.print_failed` …),
never a ticket's content.

Health: `GET http://127.0.0.1:8788/health` answers `200` with `{ status, printer, lastPollAt, lastPrintAt, printedSinceStart }`
and `503` while the printer is out of paper or unreachable or the agent cannot reach the API. Point the machine's own
monitoring at it. It cannot be reached from another machine.

If the API turns the agent's sign-in away (rate limited or busy) the agent does not try again on every poll: it waits for the `Retry-After` the API gave, or 30 seconds (never more than two minutes), so it does not keep itself — and the clinic's other devices on the same address — at the limit.

## Keeping it safe

- **Network exposure.** The agent listens on `127.0.0.1` only and has no endpoint that accepts a job; do not forward its
  health port. The printer should sit on a network that kiosks and patients do not use. The API address must be https.
- **What a job can do.** Every job is checked against a strict shape; every text is reduced to printable ASCII before it is
  placed in the ticket, so nothing in a name or an instruction can be read by the printer as a command.
- **The account.** One account per agent; rotate its password like any other (Administration → Users); a disabled account
  stops the agent at its next sign-in. Do not give the account any other role.
- **Reprints** are a staff decision (**Queue → Devices → Print again…**): a reason, twice at most, audited.

## When something is wrong

| What staff or patients see                          | Look at                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The kiosk says it could not print                   | **Queue → Devices**: the printer's state (out of paper, not reachable). Fix it; print the ticket again from the list. The patient already has the number on the screen. |
| "Printer not reporting"                             | The agent stopped or cannot reach the API: check the service and `GET /health` on that machine, then the clinic's internet.                                             |
| "No printer report yet"                             | The agent has never reported for that kiosk code: check `DEVICE_CODES` against the kiosk's code.                                                                        |
| The agent exits at start with `agent.config_error`  | The message names the setting.                                                                                                                                          |
| `agent.fatal` "The API refused the agent's sign-in" | The account's email, password or organization is wrong, or it asks for a two-step code.                                                                                 |
| Tickets print twice                                 | The agent remembers the tickets it printed for an hour and does not print one again; a second copy usually means two agents serve the same kiosk — keep one per kiosk.  |

## Binding the agent to its kiosk

By default any print agent account of the facility can serve any kiosk there. With several agents, or to limit what a stolen agent
password can do, name the agent for each kiosk: **Queue → Devices → Edit → Print agent**. That kiosk's tickets and printer state can
then be claimed and reported only by that account; set it back to "Any print agent" to undo it.

## Turning printing on for a kiosk

A kiosk **does not print** until staff say it can: **Queue → Devices → Edit → Prints tickets** (or the box when registering).
Until then it queues no ticket, shows the number only, and **Queue → Devices** reads "Ticket printing off". Order of steps
when a printer arrives: install the printer; in the staff app set the kiosk's **Printer** section (a network printer's address, or "Connected to the agent's
computer"); start the agent (it needs only its API sign-in); complete "Check it on the real printer" below; and only then turn **Prints tickets** on for that kiosk.

## Check it on the real printer

Do this once per printer model, before relying on it. Record what you saw.

1. Rehearse without a printer: set the kiosk to "Connected to the agent's computer", run the agent with `PRINTER_TYPE=dryrun`, turn **Prints tickets** on, check in
   a test patient and read the ticket in `printed/*.txt`: the number, the service, the time, the instruction.
2. Use the real printer: for a network printer, set its address, port and paper width under **Printer** in the staff app (no restart); for a printer on the agent's
   computer, set `PRINTER_TYPE=file` and `PRINTER_PATH` and restart the agent. Then check in at a kiosk: the ticket prints, is the right width, is not cut off,
   and the number is large and readable; the cut works.
3. Take the paper out: the kiosk should say it could not print, and **Queue → Devices** should show the printer needs attention
   (some models do not report the paper sensor; then only the failed print shows it). Put paper back and print the ticket again.
4. Unplug the printer's network cable: the same. Plug it back: the printer shows as working within a minute.
5. Stop the agent: **Queue → Devices** shows the printer as not reporting within two minutes.
6. Leave the machine over a night and check the first morning ticket prints.

A model that needs a different code page or command set is not supported yet: tell the development team which model.
