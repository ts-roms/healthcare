-- A kiosk's printer is set in the staff app, not in the print agent's environment (docs/runbooks/kiosk-print-agent.md).
--
-- `printer_connection` says where the printer is: `agent_local` (a printer connected to the agent's own computer; which one is set
-- on that computer, because a path on a machine is not something to change from a web page) or `network` (a printer on the clinic's
-- network at `printer_host`, `printer_port`). `paper_mm` is the roll width. The agent reads these through GET /kiosk/print/config.
-- Whether the host is on the clinic's own network is checked by the application (it is a rule about addresses, not a constraint).

ALTER TABLE kiosk_device
  ADD COLUMN printer_connection text NOT NULL DEFAULT 'agent_local' CHECK (printer_connection IN ('agent_local', 'network')),
  ADD COLUMN printer_host text CHECK (printer_host IS NULL OR (length(printer_host) BETWEEN 1 AND 253 AND printer_host ~ '^[A-Za-z0-9._:\[\]-]+$')),
  ADD COLUMN printer_port integer CHECK (printer_port IS NULL OR printer_port BETWEEN 1 AND 65535),
  ADD COLUMN paper_mm integer NOT NULL DEFAULT 80 CHECK (paper_mm IN (58, 80)),
  ADD CONSTRAINT kiosk_device_printer_network CHECK ((printer_connection = 'network') = (printer_host IS NOT NULL)),
  ADD CONSTRAINT kiosk_device_printer_only_kiosk CHECK (kind = 'kiosk' OR (printer_connection = 'agent_local' AND printer_host IS NULL AND printer_port IS NULL AND paper_mm = 80));
