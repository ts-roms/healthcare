-- Optional network allowlist per kiosk (docs/security/zero-trust-audit-2026-11-06.md, F3; docs/domains/kiosk.md).
--
-- A kiosk signs in with a password and stays signed in, without two-step verification; its credential works from
-- anywhere. A clinic with fixed outgoing addresses can now say where each kiosk may be used: a list of addresses or
-- ranges (CIDR, IPv4 or IPv6), checked by the API on every kiosk request. Empty (the default) means no restriction, so
-- nothing changes for a kiosk until staff set it. The check is in the application (kiosk.rules.ts); the database keeps
-- the list short.

ALTER TABLE kiosk_device ADD COLUMN allowed_networks text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(allowed_networks) <= 10);
