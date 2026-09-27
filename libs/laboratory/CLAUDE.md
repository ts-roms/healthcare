# Laboratory Information System (LIS) — domain instructions

Extends the root `CLAUDE.md`. Root rules win on conflict. Treat this as a serious LIS, not a results upload screen.

## Master data
Test catalog, panels, packages, categories, specimen types, containers, units, reference ranges (age-, sex-, and optionally method-specific, versioned with effective dates), critical values, turnaround time, outsourced tests, pricing reference (owned by billing), collection instructions. Departments and workstations (hematology, clinical chemistry, microbiology, urinalysis, immunology/serology, parasitology, histopathology, molecular) are **configurable data**, not enums in code.

## Order → release lifecycle
```
Order (clinic / telemedicine / dental / external / patient-request)
  → Specimen collection (accession no., barcode, collector, timestamp)
  → Receiving / routing → Worklist → Result entry (technician)
  → Verification → Authorized approval → Release → Patient portal / ordering provider
```
- Priorities: routine, STAT, scheduled. Capture fasting requirement, clinical indication, ordering provider, notes.
- Specimen states and every transition are recorded as `SpecimenEvent`s (collected, received, rejected, recollection requested, routed, stored, disposed) with actor + timestamp + reason where applicable.
- Accession numbers are unique per facility and generated server-side, idempotently.

## Result rules (non-negotiable)
- Result types: numeric, text, coded (positive/negative etc.), with units, abnormal flags, critical flags, reference range snapshot, comments, attachments, and instrument source.
- **Snapshot the applicable reference range onto the result** at entry time; later catalog changes must not alter historical interpretation.
- State machine: `entered → verified → approved → released`, plus `amended` / `corrected` / `cancelled`. Enforce transitions in the domain layer **and** with DB constraints.
- Verification and approval must be performed by users holding the required permission; the same user may not both enter and approve unless facility policy explicitly allows it (configurable, audited).
- **A released result is never overwritten.** Corrections create a new result version linked to the previous one, with reason, author, and timestamp; the previous version stays readable and is marked superseded. Notify the ordering provider and (if already released to them) the patient.
- Critical values trigger a documented notification workflow with acknowledgement tracking.
- Patients see only results that are released **and** authorized for patient access.

## Trends
Provide longitudinal views per analyte (e.g. HbA1c over time) using normalized analyte identifiers and units. Show reference ranges in context. Trends are a display aid — never generate autonomous diagnoses from them.

## Quality management & inventory (Phase 9, model must allow now)
QC and control ranges, reagent lots, calibration, equipment maintenance, temperature logs, incidents, nonconformance, corrective actions, proficiency testing, staff competency. Inventory: reagents, consumables, kits, tubes, PPE, lot numbers, expiry, stock, receiving, issuance, wastage, reorder level, supplier, purchase order. Design results so they can later reference instrument, reagent lot, and QC run.

## Boundaries
- Other domains create orders only through the laboratory order contract; they never read or write lab tables.
- Billing receives charge events (`LaboratoryOrderItemCharged` etc.); the LIS does not compute invoices.
- External/outsourced labs and instrument interfaces (e.g. HL7 v2 / ASTM) go through `libs/interoperability` adapters.

## Key events
`LaboratoryOrderCreated`, `LaboratoryOrderCancelled`, `SpecimenCollected`, `SpecimenRejected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`, `LaboratoryResultApproved`, `LaboratoryResultReleased`, `LaboratoryResultAmended`, `CriticalResultRaised`, `CriticalResultAcknowledged`.

## Permissions (initial)
`lab.order.create`, `lab.specimen.collect`, `lab.specimen.reject`, `lab.result.enter`, `lab.result.verify`, `lab.result.approve`, `lab.result.release`, `lab.result.amend`, `lab.catalog.manage`.

## Regulatory note
Laboratory licensing and reporting requirements must be validated against current official DOH issuances. Do not encode assumed regulatory rules; make them configuration and document the source.

## Docs
Keep `docs/domains/laboratory.md` current.
