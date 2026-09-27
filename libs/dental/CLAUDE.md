# Dental — domain instructions

Extends the root `CLAUDE.md`. Root rules win on conflict.

## Scope

Dental history, examination, odontogram / tooth chart, tooth surfaces, dental diagnosis, periodontal charting where appropriate, treatment plans, procedures, notes, prescriptions, imaging, appointments, follow-up, and charges.

## Rules

- **Same Patient Master.** Dental records reference the canonical patient id. Never create a second patient table.
- **Tooth identification:** store a canonical internal tooth identifier (default: FDI / ISO 3950 two-digit notation, including primary dentition) and render in the facility's configured notation (FDI, Universal, Palmer). Assumption — confirm preferred display notation with target clinics.
- Surfaces use a fixed, validated set (e.g. M, O/I, D, B/F, L/P); validate tooth–surface combinations server-side.
- **Odontogram history:** each examination produces a new chart snapshot / set of condition entries with timestamp and author. Never mutate a previous chart; the current chart is derived from history.
- Treatment plans have phases/items with status (proposed, accepted, in progress, completed, declined) and link to performed procedures.
- Procedures are recorded against tooth + surfaces and produce charge events for billing — dental does not compute invoices.
- Dental prescriptions reuse the shared prescription contract (`libs/prescription`).
- Dental imaging (X-rays, intraoral photos) lives in object storage via `libs/documents`; only metadata and references in PostgreSQL. Access through signed URLs, audited.
- Lab orders from dental go through the laboratory order contract.

## Key events

`DentalExaminationRecorded`, `DentalChartUpdated`, `DentalTreatmentPlanCreated`, `DentalTreatmentPlanAccepted`, `DentalProcedurePerformed`.

## Permissions (initial)

`dental.record.read`, `dental.record.write`, `dental.chart.write`, `dental.treatment-plan.manage`, `dental.procedure.record`, `dental.imaging.read`, `dental.imaging.upload`.

## Docs

Keep `docs/domains/dental.md` current.
