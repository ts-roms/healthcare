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

1. A kiosk registered at the facility (**Queue → Devices**, or `POST /kiosk/admin/devices`) — note its **code**.
2. A staff account for the agent: **Administration → Users**, role **Kiosk print agent** at the kiosk's facility, and nothing
   else. If your organization requires two-step verification, exempt this account with a reason (the agent signs in with a
   password only). Use a long random password; the account can claim ticket jobs and report printer state and can open no
   patient record.
3. The printer: an 80 mm or 58 mm ESC/POS thermal printer. Reached over the clinic's network (raw port, normally 9100) or
   through the operating system (a device file such as `/dev/usb/lp0`, or a shared raw queue such as `\\localhost\TicketPrinter`
   on Windows). Direct USB drivers are not included. Give a network printer a fixed address on the clinic's own network.
4. Node 22 on the machine, and a copy of this repository (or a build of the tool).

## Settings (environment variables)

| Variable                             | Meaning                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`                       | The API address including `/api/v1`. **https is required**; http is accepted only for `localhost`.                                                          |
| `AGENT_EMAIL`, `AGENT_PASSWORD_FILE` | The agent's account. Prefer a file holding the password (readable only by the agent's service account); `AGENT_PASSWORD` is accepted but shows in listings. |
| `ORGANIZATION_ID`                    | Only if the account belongs to several organizations.                                                                                                       |
| `FACILITY_ID`                        | The facility the kiosk and the account belong to.                                                                                                           |
| `DEVICE_CODES`                       | Comma-separated kiosk codes this printer serves (one or a few kiosks sharing a printer).                                                                    |
| `PRINTER_TYPE`                       | `tcp` (network), `file` (operating-system path) or `dryrun` (write tickets to a folder, no printer).                                                        |
| `PRINTER_HOST`, `PRINTER_PORT`       | For `tcp`. The host must be on the clinic's own network (a private address, or a name ending `.local`/`.lan`, or a single-word name). Port default 9100.    |
| `PRINTER_PATH`                       | For `file`.                                                                                                                                                 |
| `DRYRUN_DIR`                         | For `dryrun` (default `./printed`).                                                                                                                         |
| `PAPER_MM`                           | `80` (48 characters a line, default) or `58` (32).                                                                                                          |
| `TIMEZONE`                           | The facility's time zone for the time on the ticket (default `Asia/Manila`).                                                                                |
| `POLL_MS`, `HEARTBEAT_MS`            | How often it asks for tickets (default 2000) and reports the printer (default 30000).                                                                       |
| `HEALTH_PORT`                        | The local health port (default 8788, `127.0.0.1` only).                                                                                                     |

The agent refuses to start, and says why, when a setting is wrong (an http address that is not local, a printer outside the
clinic's network, no password, an unknown time zone).

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

## Turning printing on for a kiosk

A kiosk **does not print** until staff say it can: **Queue → Devices → Edit → Prints tickets** (or the box when registering).
Until then it queues no ticket, shows the number only, and **Queue → Devices** reads "Ticket printing off". Order of steps
when a printer arrives: install the printer, run the agent with `PRINTER_TYPE=dryrun`, then the real printer, complete "Check
it on the real printer" below, and only then turn **Prints tickets** on for that kiosk.

## Check it on the real printer

Do this once per printer model, before relying on it. Record what you saw.

1. Run the agent with `PRINTER_TYPE=dryrun` first and read a ticket in `printed/*.txt`: the number, the service, the time, the instruction.
2. Switch to the real printer (`tcp` or `file`) and check in at a kiosk: the ticket prints, is the right width, is not cut off,
   and the number is large and readable; the cut works.
3. Take the paper out: the kiosk should say it could not print, and **Queue → Devices** should show the printer needs attention
   (some models do not report the paper sensor; then only the failed print shows it). Put paper back and print the ticket again.
4. Unplug the printer's network cable: the same. Plug it back: the printer shows as working within a minute.
5. Stop the agent: **Queue → Devices** shows the printer as not reporting within two minutes.
6. Leave the machine over a night and check the first morning ticket prints.

A model that needs a different code page or command set is not supported yet: tell the development team which model.
