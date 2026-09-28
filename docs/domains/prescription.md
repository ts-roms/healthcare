# Prescriptions (`libs/prescription`)

## Purpose

Issuing, cancelling and replacing prescriptions within an encounter, with drug–allergy **decision support**; and
**dispensing** prescribed items from inventory stock (Phase 9, migration `0053_prescription_dispensing.sql`, staff `/pharmacy`).

## Entities

`prescription` (number `RX########` per organization, prescriber, encounter, status `active | cancelled | superseded`,
allergy warnings shown and the override reason) and `prescription_item` (generic name required, brand optional,
strength, form, dose, route, frequency, duration, quantity, refills, instructions).

`prescription_dispense` — one item handed over: prescription and item (same patient, trigger), facility, inventory item,
storage location, quantity **in the inventory item's stock unit** (with the item name and unit as snapshots), the stock
movement group, note, who and when; `recorded → reversed` once (who, when, reason, the return's movement group). Never
deleted; nothing else changes (trigger).

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

**Dispensing**

- Only **active** prescriptions are dispensed (a cancelled or superseded one is refused, `prescription_not_active`). The
  prescription row is locked while dispensing, so concurrent dispenses are serialized.
- The dispenser chooses the inventory item and storage location (of the selected facility) per prescribed item; the
  stock leaves inventory **in the same transaction** (first-expiry-first-out, never an expired lot; a shortage refuses
  the whole request). The screen lists stock whose name matches the prescribed medicine first — a name match only; the
  pharmacist decides what is equivalent. Only medicines and medical supplies are dispensed (`DISPENSABLE_CATEGORIES`;
  anything else `item_category_not_allowed`, and not offered).
- **No more than prescribed** (quantity × (1 + refills)) when the stock unit is the prescribed unit (case and simple
  plurals ignored, `dispensing.rules.ts`) — `exceeds_prescribed` with what remains. When the units differ (e.g. a
  syrup prescribed in mL, stocked in bottles) the platform cannot compare and shows both; the pharmacist's judgement applies.
- Controlled items: the movement's reference is the prescription number and its reason "Dispensed on prescription".
- **Reversal** (a mistaken dispense) needs a reason, happens at the dispensing facility, once; the same lots return to
  the same location (`restore`), also for a prescription cancelled since.
- Compliance dependencies: the dangerous drugs register, special prescription forms and pharmacist dispensing records
  required by regulation (e.g. PDEA / FDA / the Pharmacy Act) are not implemented.

## Events

`PrescriptionIssued`, `PrescriptionCancelled` (payload `replacedBy` on replacement), `PrescriptionDispensed` (dispense
ids), `PrescriptionDispenseReversed` (dispense id).

## Permissions

`prescription.read`, `prescription.issue`, `prescription.cancel`, `prescription.dispense` (pharmacist, nurse, org_admin;
dispensing and reversing also need `inventory.move`). New system role **Pharmacist** (`pharmacist`): patient search and
read, prescriptions read and dispense, inventory read and move.

## API

`POST /prescriptions`, `GET /prescriptions?patientId=|encounterId=`, `GET /prescriptions/:id`,
`POST /prescriptions/:id/{replace,cancel}`.

Dispensing (`/api/v1/dispensing`, selected facility required): `GET stock` (medicines and supplies with usable stock),
`GET prescriptions?number=RX…` (→ id), `GET prescriptions/:id` (patient identification, items, dispensed per unit,
remaining, dispenses), `POST prescriptions/:id/dispenses` (`lines[]`: prescription item, inventory item, location,
quantity; `note`), `POST dispenses/:id/reverse` (`reason`), `GET dispenses?date=` (the facility's day). Audited:
`prescription.dispensing.view`, `prescription.dispense`, `prescription.dispense.reverse`, `prescription.dispense.list`
(with the patient).

## Integration points

`PrescribingContext` port (prescriber, encounter state, allergies, patient identification) implemented in `apps/api`
over `ClinicQueries` and `PatientRecordService`. `DispensingStock` port (stock available, take, give back inside the
dispensing transaction) implemented over `InventoryStockService` (`apps/api/src/app/adapters/inventory-adapters.ts`).
The FK `(patient_id, encounter_id)` guarantees a prescription's encounter belongs to the same patient.
The staff app prescribes from the encounter workspace (`docs/architecture/staff-app.md`); it shows the API's
`allergy_warning` details as decision support and sends the prescriber's override reason.
