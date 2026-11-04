-- A kiosk may name the print agent account that serves it (docs/security/kiosk-audit-phase-6.md, KA-04).
--
-- Until now any account holding the print agent permission at a facility could claim the tickets of, and report the printer
-- of, any kiosk there by naming its code. With the column set, only that account may; left empty, any agent of the facility
-- may (the earlier behaviour, for facilities with one agent and one printer).

ALTER TABLE kiosk_device
  ADD COLUMN print_agent_user_id uuid REFERENCES app_user (id),
  ADD CONSTRAINT kiosk_device_agent_only_kiosk CHECK (print_agent_user_id IS NULL OR kind = 'kiosk');
