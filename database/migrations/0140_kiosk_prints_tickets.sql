-- A kiosk prints tickets only when staff say it has a printer (docs/domains/kiosk.md, "Printing and devices").
--
-- Until now the kiosk screen reported whether it had a printer, and migration 0139 moved that to the print agent. A clinic
-- with no printer yet — the usual state when the kiosk is installed — then had every ticket queue a print job nobody would
-- print, and its kiosk said "Printing your ticket…" and then "could not print". The setting is explicit and starts off:
-- a kiosk queues no ticket job until staff turn printing on, once the printer and the print agent are working.

ALTER TABLE kiosk_device ADD COLUMN prints_tickets boolean NOT NULL DEFAULT false;
