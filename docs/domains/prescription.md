# Prescriptions (`libs/prescription`)

## Purpose

Issuing, cancelling and replacing prescriptions within an encounter, with drug–allergy **decision support**; and
**dispensing** prescribed items from inventory stock (Phase 9, migration `0053_prescription_dispensing.sql`, staff `/pharmacy`).
Also the organization's own [medicine settings](#medicine-settings) read by the assistant's prescribing checks (migration `0156`).

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
`POST /prescriptions/:id/{replace,cancel}`. Medicine settings: `GET|POST /prescribing/medicines`, `PUT /prescribing/medicines/:id`
([Medicine settings](#medicine-settings)).

**Prescriptions issued at a facility** (`GET /prescriptions/issued`, `prescription.read`, selected facility required;
`PrescriptionListService`): newest first over a period of the facility's calendar days (`from`, `to`; today by default; at most
92 days), optionally by `status` or only the signed-in practitioner's (`mine=true`; `422 not_a_practitioner` for an account not
linked to one). Each row: number, time, status, consultation, patient (minimal identification), prescriber name, and what was
prescribed (name, strength, form, quantity — not the dose instructions, notes or allergy override: open the prescription for
those), with the cancellation reason or the prescription it replaces. `counts` per status cover the whole period; at most 300
rows (`truncated`). Every patient listed is audited (`prescription.list`, metadata `view: facility`). Prescriber names come
through the `PrescribingContext.practitionerNames` port. Staff: **Clinic → Prescriptions** (`/clinic/prescriptions`).

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

## Assistant suggestions on the pharmacy screens

Two rules of the heuristic assistant ([assistant.md](assistant.md)), off until an administrator turns them on, read
dispensing and stock and change nothing: `dispensing.short-stock` on `/pharmacy` (medicines that active prescriptions issued
here in N days still need more of — one fill, in the prescribed unit — than the facility's usable stock of the items named
like them) and `dispensing.course-expiry` on `/pharmacy/[prescriptionId]` (stock whose lot taken first expires before the
course would end if handed over today). Pure rules in `libs/prescription/src/lib/assistant/pharmacy.rules.ts` (with the
name and strength matching, `stockMatches`), read through `PrescriptionAssistantQueries.pendingItems | dispensingItems |
dispensesBetween`; the stock comes from inventory through the API. Pharmacists see them since migration `0157`
(`assistant.use`).

## Medicine settings

Migration `0156_prescribing_medicines.sql`. The organization's own settings per medicine, read only by the assistant's
prescribing rules ([assistant.md](assistant.md)), which check a prescription in the prescribing dialog before it is issued
and are off until an administrator turns them on. Nothing here blocks or changes a prescription, and nothing is shipped:
no dose, class, interaction or check is built in; every value is the organization's, validated by its physicians or
pharmacist (compliance register).

`prescribing_medicine`: the medicine as the organization writes it (`name`) and its words as matched (`name_key`, unique in
the organization, so "Metformin HCl 500 mg" and "metformin hcl" are one setting), an optional class of its own
(`class_name`: two current medicines of one class are a duplicate therapy), an optional maximum daily dose with its unit
(both or neither), `check_renal` and `check_pregnancy` (prompt a kidney-function or pregnancy check before prescribing), an
optional note shown with the suggestions, `active | inactive`, an optimistic `version`; at least a class, a maximum or a
check. Matching is by words (`medicineWords` in `libs/prescription/src/lib/assistant/prescribing.rules.ts`: lower case,
without accents, strengths and dosage forms): a setting applies to every prescribed name holding all its words, the most
specific one first.

`PrescribingMedicineService` (`libs/prescription/src/lib/medicines`): create and update (version-checked, `409
duplicate_medicine_setting` for a medicine that has one), audited `prescription.medicine-setting.create | update` with the
values changed. API: `GET /prescribing/medicines[?includeInactive=true]` (`prescription.read`), `POST /prescribing/medicines`
and `PUT /prescribing/medicines/:id` (`clinic.configure`); no new permission. Staff: **Settings → Clinical → Prescribing
checks** (`/clinic/prescribing`).

The prescribing dialog (`prescriptions-panel.tsx`) sends the draft to `POST /assistant/suggestions/check` when the person
holds `assistant.use`: on **Issue**, findings are shown first ("Before you issue") and the button becomes **Issue anyway**;
without findings, or when the assistant cannot answer, the prescription is issued at once. The drug–allergy check is
unchanged and still runs when the prescription is issued.
