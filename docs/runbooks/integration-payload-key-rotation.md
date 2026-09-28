# Runbook — rotating the integration payload key

**When:** on a schedule set by the security policy, when someone with access to the key leaves, or when the key may be
exposed. **Who:** operators with access to the secrets store and deployments of the API and `apps/integration-worker`.
**Downtime:** none; queued exchanges do not need to be drained.

Background: [integration worker — payload keys and rotation](../architecture/integration-worker.md#payload-keys-and-rotation).
Prepared payloads (e.g. PhilHealth claims, DOH case reports) wait in `integration_exchange_payload`, sealed with
AES-256-GCM and tagged with the id of the key used. The worker opens each with the key it names.

## Steps

1. **Generate** the new key and choose an id that sorts and reads well (letters, digits, `_`, `-`):

   ```sh
   openssl rand -base64 32
   ```

   Store it in the secrets manager. Never commit it or reuse `MFA_ENCRYPTION_KEY` (production refuses that).

2. **Add the new key everywhere, still sealing with the old one.** On the worker and on every API instance:

   ```sh
   # Single-key setups: INTEGRATION_PAYLOAD_KEY stays (it is key id "default").
   INTEGRATION_PAYLOAD_KEYS={"2026-10":"<new key>"}
   INTEGRATION_PAYLOAD_KEY_ID=default            # or the current id if a key ring is already used
   ```

   Deploy the **worker first**, then the API. Check the worker's start-up log: no "Queued payloads are sealed with key
   id(s) not configured here" error.

3. **Switch the current key** on every API instance: `INTEGRATION_PAYLOAD_KEY_ID=2026-10`, deploy. New payloads are
   sealed with it; queued ones keep the old key and are still opened.

4. **Check what still needs the old key.** Two kinds of stored values are sealed with the key ring:
   - prepared payloads waiting for the integration worker (`integration_exchange_payload`; each is deleted when its
     exchange is final — retries back off for up to about an hour, and the reconciler re-enqueues stranded ones every
     5 minutes);
   - received FHIR import content (`fhir_import_content`; rejected imports are purged 30 days after rejection, accepted
     imports are **kept**).

   A platform administrator sees both per key id under **Integrations → Payload encryption keys**
   (`/admin/integrations`, `GET /api/v1/integrations/payload-keys`: counts and key ids only), or:

   ```sql
   SELECT key_id, count(*) FROM integration_exchange_payload GROUP BY key_id;
   SELECT key_id, count(*) FROM fhir_import_content GROUP BY key_id;
   ```

   Continue when nothing remains for the old id (`default` in the example) — and nothing with `key_id` NULL if the old
   key is the one that sealed payloads from before key ids existed.

   Kept FHIR import content means the old key is usually still needed. Then keep it listed in
   `INTEGRATION_PAYLOAD_KEYS` as a **decrypt-only** key (not current: nothing new is sealed with it) and only revoke
   write access to it in the secrets manager; remove it when the imports that need it are purged. For a key that may
   be exposed, treat the stored content as exposed regardless of rotation, and follow the incident process.

5. **Remove the old key** from the worker and the API (drop it from `INTEGRATION_PAYLOAD_KEYS`, or unset
   `INTEGRATION_PAYLOAD_KEY`) once nothing needs it, deploy, and revoke it in the secrets manager. The screen then shows
   it as gone; a key still listed and needed by nothing shows "Not needed — can be removed".

## If a key was removed too early

Exchanges whose payload names a missing key fail without sending anything (`last_error`:
`Payload unusable: sealed with key "…", which is not configured on the integration worker`), and the domain records the
failure (e.g. a DOH case report shows "Not sent"). Put the key back if it still exists; otherwise staff submit again
(a new idempotency key), which prepares and seals a new payload with the current key. Find them with:

```sql
SELECT id, system, operation, resource_type, resource_id, completed_at
FROM integration_exchange WHERE status = 'failed' AND last_error LIKE 'Payload unusable: sealed with key%';
```
