# Integration worker

`apps/integration-worker` sends outbound exchanges to external systems (today, all through unconfigured adapters:
PhilHealth eClaims and eligibility, DOH case reporting, reference laboratory send-outs; later others). It is a BullMQ consumer like the
notification worker: no HTTP server, one Nest application context, scaled and restarted independently of the API.

## Why a separate process

- External systems are slow and fail; their calls must not run in the API's request path or its outbox relay.
- Retries with backoff, dead-lettering and reconciliation are queue concerns.
- Adapters and their credentials live in one small process with no access to clinical domains (lint: `scope:worker`
  may depend on `scope:shared` and `scope:interoperability` only).

## Hand-over from the API

The worker cannot read domain data, so the API prepares everything:

```
API (request, one transaction)                       Redis (BullMQ "integrations")      integration-worker
───────────────────────────────                      ─────────────────────────────      ──────────────────
integration_exchange        status queued,
                            payload_digest = SHA-256(canonical JSON)
integration_exchange_payload  AES-256-GCM(payload)   ◄─ INTEGRATION_PAYLOAD_KEYS ─►   decrypt, check the digest
audit + IntegrationExchangeRequested (outbox)
        │ outbox relay (at-least-once)
        └─ ExchangeDispatch ───────────────────────► job { exchangeId }  (jobId =
                                                     exchangeId: deduped) ───────────► IntegrationExchangeProcessor
                                                                                         handler.send(payload, idempotencyKey)
API ◄── IntegrationExchangeCompleted (outbox) ◄─────────────────────────────────────── final status, payload deleted, audit
 └─ domain reaction, e.g. PhilHealthOutcomes → billing marks the claim submitted
```

- **No PHI in Redis**: the job carries only the exchange id. The payload is encrypted in PostgreSQL
  (`integration_exchange_payload`) and deleted as soon as the exchange is final. The exchange log keeps a digest, the
  status, attempts, the external reference and reason codes — never the payload.
- **Integrity**: the worker refuses a payload whose SHA-256 does not match the digest recorded at request time.
- **Idempotency**: one exchange per (organization, system, idempotency key); the job id is the exchange id; an exchange
  that is no longer `queued` is skipped; adapters receive the exchange's idempotency key and must be idempotent.

## Retries, failures, recovery

| Situation                                          | What happens                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter reports `failed`, retryable                | attempts + 1, last error kept; BullMQ retries with exponential backoff (60 s base, 5 attempts)                                         |
| Last attempt fails, or not retryable               | exchange `failed` (final)                                                                                                              |
| Adapter throws                                     | treated as retryable                                                                                                                   |
| `accepted` / `rejected` / `not_configured`         | final; `IntegrationExchangeCompleted` published for the API (an accepted exchange may carry result codes, e.g. an eligibility answer)  |
| Job lost (Redis restart, enqueue failed)           | the worker's reconciler (every 5 min) re-enqueues exchanges queued > 10 min and never started, or stalled > 30 min                     |
| Payload missing / undecryptable / digest mismatch  | exchange `failed`; nothing sent                                                                                                        |
| Payload sealed with a key the worker does not hold | exchange `failed` (final): `Payload unusable: sealed with key "…", which is not configured…`; nothing sent; key ids logged at start-up |

Finished and failed jobs are removed from Redis (`removeOnComplete`, `removeOnFail`); the database is the record.

## Operator review

Administrators (`integration.exchange.manage`, org_admin) review exchanges at **Administration → Integrations**
(`/admin/integrations`; API `GET /api/v1/integrations/exchanges`):

- **Needs attention** — exchanges that ended `failed`, `rejected` or `not_configured` and are not yet resolved, and
  queued exchanges that look **stalled** (never picked up 10 min after the request, or no attempt for 30 min).
- **Re-queue** (`POST …/{id}/requeue`) — a stalled exchange whose sealed payload is still held goes back on the queue
  (deduplicated by exchange id; audited).
- **Resolve** (`POST …/{id}/resolve`, a note is required) — records that someone reviewed an unsuccessful exchange and
  what was done (e.g. "checked through PhilHealth's own channel instead"). The exchange's outcome never changes
  (migration `0025`; audited with the note as the reason).
- **Retrying a final failure** happens at the source, not here: the payload is deleted once an exchange is final, so
  the request is prepared again (with a new idempotency key) from the invoice, case report or patient record — each row
  links to it. This keeps what is sent consistent with the current record and its checks.

The screen shows status, attempts, reference, reason codes and errors, the patient's number and name — never the
payload.

## Adding an integration

1. Implement an `ExchangeHandler` (`system`, `operation`, `send(payload, idempotencyKey)`) in `libs/interoperability`,
   register it in `EXCHANGE_HANDLERS` (`IntegrationWorkerModule`).
2. On the API side, prepare the payload and call `IntegrationExchanges.request(tx, actor, …)` inside the domain
   transaction; react to `IntegrationExchangeCompleted` for your `system`/`operation`.
3. Give the operation a human name and a source link on the review screen
   (`apps/staff/src/app/(staff)/admin/integrations/exchange-labels.ts`).
4. Document the external specification in `docs/interoperability/` — never implement from an assumed one.

## Configuration and running

- `REDIS_URL`, `DATABASE_URL` as for the API.
- Payload keys (32 bytes, base64; the API and the worker must hold the same keys). **Required in production**, and
  separate from `MFA_ENCRYPTION_KEY` (refused if equal); elsewhere `MFA_ENCRYPTION_KEY` stands in (key id `development`).
  - `INTEGRATION_PAYLOAD_KEY` — a single key (key id `default`); still supported.
  - `INTEGRATION_PAYLOAD_KEYS` — a key ring, JSON `{"<key id>": "<key>", …}` (ids: letters, digits, `_`, `-`), and
    `INTEGRATION_PAYLOAD_KEY_ID` — the key new payloads are sealed with (required when more than one key is configured;
    may name `default`). Both may be combined with `INTEGRATION_PAYLOAD_KEY`.

## Payload keys and rotation

Payloads are sealed as `v2.<key id>.<iv>.<tag>.<ciphertext>` (AES-256-GCM; the `v2.<key id>` header is authenticated)
with the current key, and `integration_exchange_payload.key_id` repeats the id (a CHECK keeps them consistent;
migration `0046_integration_payload_keys.sql`). The worker opens each payload with the key it names, so a key can be
rotated **without draining the queue**. Payloads sealed before key ids existed (`v1.…`, `key_id` NULL) are opened by
trying each configured key. A payload whose key is no longer configured fails its exchange without sending anything;
the worker logs such key ids at start-up (`IntegrationExchangeProcessor.unavailableKeyIds`).

Procedure ([runbook](../runbooks/integration-payload-key-rotation.md)):

1. Generate a key (`openssl rand -base64 32`) and choose an id (e.g. `2026-10`).
2. **Add** it to `INTEGRATION_PAYLOAD_KEYS` on the worker **and** the API, keeping the current key and
   `INTEGRATION_PAYLOAD_KEY_ID` unchanged. Deploy the worker first (it must be able to open what the API will seal).
3. **Switch** `INTEGRATION_PAYLOAD_KEY_ID` to the new id on every API instance. New payloads use the new key; queued ones
   keep theirs and are still opened.
4. **Wait** until nothing sealed with the old key is queued:
   `SELECT key_id, count(*) FROM integration_exchange_payload GROUP BY key_id;` (payloads are deleted as soon as their
   exchange is final; a `NULL` key id is a payload from before key ids, opened with any listed key).
5. **Remove** the old key (and `INTEGRATION_PAYLOAD_KEY`, if it was the old key) from the API and the worker.

- `pnpm dev` starts it with the other apps; `pnpm dev:integration-worker` alone.
