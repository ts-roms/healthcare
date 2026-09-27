# Prescriptions (`libs/prescription`)

## Purpose

Issuing, cancelling and replacing prescriptions within an encounter, with drug–allergy **decision support**.

## Entities

`prescription` (number `RX########` per organization, prescriber, encounter, status `active | cancelled | superseded`,
allergy warnings shown and the override reason) and `prescription_item` (generic name required, brand optional,
strength, form, dose, route, frequency, duration, quantity, refills, instructions).

## Rules

- **Immutable once issued** — enforced by database triggers: items are append-only; only the status (and cancellation
  fields) of an active prescription may change; prescriptions cannot be deleted.
- Issued only during an in-progress encounter, by a practitioner (physician or dentist) linked to the signed-in account.
- Corrections use **replace**: the old prescription becomes `superseded` (reason recorded) and the new one references it.
- **Decision support (CLAUDE.md §35):** medicines are name-matched against active medication/biologic allergies. A
  match returns `409 allergy_warning` with the evidence; the prescriber may proceed with `allergyOverrideReason`. The
  warnings are stored on the prescription and the override is audited as `decision-support.override`. The check does not
  know drug classes or cross-reactivity — **no warning is not proof of safety**.
- Dangerous-drug (controlled substance) prescribing requirements are not implemented and must be confirmed against
  current official requirements before being added.

## Events

`PrescriptionIssued`, `PrescriptionCancelled` (payload `replacedBy` on replacement).

## Permissions

`prescription.read`, `prescription.issue`, `prescription.cancel`.

## API

`POST /prescriptions`, `GET /prescriptions?patientId=|encounterId=`, `GET /prescriptions/:id`,
`POST /prescriptions/:id/{replace,cancel}`.

## Integration points

`PrescribingContext` port (prescriber, encounter state, allergies) implemented in `apps/api` over `ClinicQueries`.
The FK `(patient_id, encounter_id)` guarantees a prescription's encounter belongs to the same patient.
