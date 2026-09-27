# Audit (`libs/audit`)

## Purpose
Append-only record of every sensitive action (CLAUDE.md §22).

## Entity
`audit_event` — see `docs/security/access-control.md` for fields and coverage.
Protected by triggers against UPDATE, DELETE and TRUNCATE. No foreign keys, so
auditing never blocks and outlives the audited records.

## Usage
```ts
await this.db.transaction(async (tx) => {
  // …change…
  await this.audit.record(tx, actor, { action: 'patient.update-demographics', resourceType: 'patient', resourceId, patientId, changes });
});
```
Use `recordStandalone` for reads and denials. Use `diffChanges` for field-level before/after.

## Query
`GET /audit-events` (filters: patient, actor, resource, action, time range),
permission `audit.read`, itself audited as `audit.search`.
