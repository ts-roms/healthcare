# Kiosk print agent

A small service that prints the Healthcare Management Platform's kiosk queue tickets. It runs on a machine in the clinic
next to the printer, signs in to the API as its own restricted account and **pulls** ticket jobs; nothing can send it a
job. Full set-up and operation: [`docs/runbooks/kiosk-print-agent.md`](../../docs/runbooks/kiosk-print-agent.md). Design:
[`docs/domains/kiosk.md`](../../docs/domains/kiosk.md) ("Printing and devices").

```bash
# the settings are environment variables; see the runbook for each one
API_BASE_URL=https://clinic.example.ph/api/v1 AGENT_EMAIL=agent@clinic.example.ph AGENT_PASSWORD_FILE=/etc/kiosk-agent/password \
FACILITY_ID=<facility id> DEVICE_CODES=front-1 PRINTER_TYPE=tcp PRINTER_HOST=192.168.1.50 pnpm kiosk:print-agent

# try it without a printer: every ticket is written to ./printed as raw bytes and a readable .txt
PRINTER_TYPE=dryrun ... pnpm kiosk:print-agent
```

Tests: `pnpm nx test kiosk-print-agent`.

**No real printer has been tested with this agent.** Check it on your own printer model before relying on it.
