-- Transactional outbox for domain events (CLAUDE.md §26).
-- Events are written in the same transaction as the change that caused them and
-- dispatched afterwards by the outbox relay (at-least-once; handlers are idempotent).
-- Payloads carry identifiers, not clinical content.
CREATE TABLE domain_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position         bigserial   NOT NULL UNIQUE,
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  event_type       text        NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  aggregate_type   text        NOT NULL,
  aggregate_id     uuid        NOT NULL,
  facility_id      uuid,
  patient_id       uuid,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       text,
  failed_at        timestamptz,
  CHECK (published_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX domain_event_pending_idx ON domain_event (position) WHERE published_at IS NULL AND failed_at IS NULL;
CREATE INDEX domain_event_patient_idx ON domain_event (patient_id, occurred_at) WHERE patient_id IS NOT NULL;
