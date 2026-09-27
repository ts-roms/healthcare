-- Shared database primitives.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generic guard for append-only tables (audit events, consent history, ...).
CREATE FUNCTION prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Idempotency records for unsafe API requests carrying an Idempotency-Key header.
CREATE TABLE idempotency_record (
  user_id          uuid        NOT NULL,
  idempotency_key  text        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  method           text        NOT NULL,
  path             text        NOT NULL,
  request_hash     text        NOT NULL,
  state            text        NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  CHECK (state = 'in_progress' OR response_status IS NOT NULL)
);
CREATE INDEX idempotency_record_expires_idx ON idempotency_record (expires_at);
