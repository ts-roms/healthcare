# Two-step verification keys: binding and rotation

Staff and MyHealth authenticator secrets (TOTP seeds) are stored encrypted with AES-256-GCM. Since the zero-trust work
(`docs/security/zero-trust-audit-2026-11-06.md`) each one is sealed in the `v3.<keyId>.…` format (`sealBound` in
`libs/core/src/lib/security/crypto.ts`):

- **Bound to its row.** The account it belongs to (`app_user:<id>`, `patient_portal_account:<id>`) is part of the
  authenticated data, so a sealed secret copied onto another account does not open. Someone able to write the database
  cannot give themselves another person's second factor.
- **Keyed.** The key id is in the value and authenticated, so keys can be rotated without re-encrypting everything at
  once.

Secrets stored before this (`v1.…`, one key, no binding) still open. Each is sealed again in the current form the next
time it is used successfully, with the same rule for a value sealed with an older key. Re-sealing on use rotates keys
without a batch job.

## Settings (API and both workers)

| Variable                | Meaning                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `MFA_ENCRYPTION_KEY`    | Required. The key with id `default`.                                                          |
| `MFA_ENCRYPTION_KEYS`   | Optional JSON `{"<id>": "<base64 32-byte key>"}`: further keys, for rotation.                 |
| `MFA_ENCRYPTION_KEY_ID` | Optional. The id new secrets are sealed with (default `default`). Must name a configured key. |

## Rotate the key

1. Generate a key: `openssl rand -base64 32`.
2. Add it under a new id and make it current, keeping the old one: `MFA_ENCRYPTION_KEYS={"2026-11":"<new key>"}`,
   `MFA_ENCRYPTION_KEY_ID=2026-11` (on the API and both workers, through Terraform or the dashboard). Redeploy.
3. New secrets are sealed with `2026-11`; existing ones move to it as people sign in. To see what still needs the old
   key, as the database owner:

   ```sql
   SELECT count(*) FILTER (WHERE mfa_secret_encrypted NOT LIKE 'v3.2026-11.%') AS staff_left FROM app_user WHERE mfa_enabled;
   SELECT count(*) FILTER (WHERE mfa_secret_encrypted NOT LIKE 'v3.2026-11.%') AS patients_left FROM patient_portal_account WHERE mfa_enabled;
   ```

4. Remove the old key only when both counts are 0. Anyone still sealed with a removed key cannot sign in with their
   app (their secret names a key that is gone): reset their two-step verification (staff: **Administration → Users**;
   MyHealth: the patient record) so they set it up again.

If the old key leaked, do not wait for sign-ins: rotate as above, then reset two-step verification for everyone still
on the old key (the counts above), because their secrets can be read with it.
