# Dental

## Purpose

Dentistry on the same Patient Master (Phase 6): the odontogram and its history, dental examinations, treatment plans
decided by the patient, performed procedures (which change the chart, complete plan items and are charged by
billing) and dental imaging. Library: `libs/dental` (`scope:dental`); rules in `libs/dental/CLAUDE.md`.

**A dental visit is a clinic encounter with a dentist.** Appointments, the queue, SOAP notes, diagnoses,
prescriptions (`libs/prescription` already allows dentists to prescribe) and laboratory orders reuse the clinic
workflow; this domain adds only what is specific to dentistry. There is no second patient table and no second
encounter model.

Also: [periodontal charting](#periodontal-charting), [dental records in MyHealth](#dental-records-in-myhealth),
[supplies used](#supplies-used) (from inventory).

Not in scope yet: orthodontic records, dental FHIR resources, and a licensed procedure code set.

## Entities

- **Tooth codes** — stored in FDI / ISO 3950 two-digit notation: permanent `11–18, 21–28, 31–38, 41–48`, primary
  `51–55, 61–65, 71–75, 81–85` (CHECK constraints). Displayed in the facility's notation
  (`dental_facility_setting.notation`: `fdi` default, `universal` 1–32 / A–T, `palmer` "UR6") by
  `libs/domain/src/dental.ts`. _Assumption — confirm the preferred display notation with target clinics._
- **Surfaces** — a fixed canonical set: `M` mesial, `D` distal, `O` occlusal (premolars and molars only), `I`
  incisal (incisors and canines only), `B` buccal / facial / labial, `L` lingual / palatal. The API rejects a surface
  the tooth does not have (`libs/dental/src/lib/dental.rules.ts`); the screens name them anatomically (labial on
  anterior teeth, palatal on upper teeth).
- **Tooth conditions** — `caries`, `restoration`, `sealant` (need surfaces), `fracture` (surfaces optional), `crown`,
  `root_canal`, `implant`, `watch` (whole tooth), and `missing`, `pontic`, `impacted`, `unerupted` (whole tooth,
  exclusive: no other finding on the same tooth). A tooth charted with no findings is sound.
- `dental_procedure_type` — the organization's procedure catalog: its own `code`, name, `site` (`mouth` — e.g. oral
  prophylaxis; `tooth` — e.g. extraction; `surface` — e.g. composite restoration) and optional `chart_effect` (the
  condition it leaves: restoration or sealant on the treated surfaces; crown, root canal, missing, implant, pontic on
  the tooth). Code, site and effect are fixed once created; name and status can change. **No national dental
  procedure coding is assumed** (a licensed set such as CDT, or PhilHealth dental benefit codes, is a configuration
  and compliance decision — see [dependencies](../interoperability/dependencies.md)).
- `dental_examination` — recorded by a dentist during the patient's encounter in progress: oral hygiene (good, fair,
  poor), notes (history, soft tissue, occlusion, periodontal remarks). Immutable except for being marked **entered in
  error** with a reason (trigger `dental_record_guard`).
- `dental_tooth_state` + `dental_tooth_finding` — the chart history, **append-only** (triggers): one state per tooth
  charted by an examination or changed by a procedure, ordered by an identity `sequence`, with its findings. The
  **current chart** is the latest state of each tooth whose examination or procedure is still `recorded`; teeth never
  charted are absent. Marking a source entered in error removes its states from the current chart, so the tooth's
  previous state shows again. An examination charts only the teeth the dentist changed; other teeth keep their state.
- `dental_treatment_plan` (+ `_item`) — a titled plan by a dentist with phased items (procedure type, tooth,
  surfaces, note). Plan status `proposed → accepted → in_progress → completed`, or `declined`, or `discontinued`
  (reason); item status `proposed → accepted | declined → completed` (linked to the procedure) or `cancelled`. The
  patient's decision is recorded per item with a note on how they decided (e.g. options and fees explained, consent
  form signed). Plans carry **no prices**: fees are billing's.
- `dental_procedure` — performed during the patient's encounter in progress: procedure type, tooth and surfaces as
  its site requires, notes, optional accepted plan item it carries out. Immutable except entered in error. One
  recorded procedure per plan item (partial unique index).
- `dental_image` — a radiograph or photo: the file is a **private document** in object storage (`libs/documents`,
  category `imaging`; JPEG, PNG, HEIC, TIFF or DICOM); this row holds the kind (periapical, bitewing, panoramic,
  cephalometric, occlusal, CBCT, intraoral/extraoral photo, other), teeth shown, date taken, notes and optional
  encounter. Immutable except entered in error.
- `dental_organization_setting` — the organization's choice to show patients their dental records in MyHealth
  (`portal_dental_records`, off by default; optimistic `version`; migration `0056`).

## Commands

| Command                      | Endpoint                                                                            | Rules                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record examination           | `POST /dental/patients/:patientId/examinations`                                     | Actor is a dentist (practitioner profession); the encounter is the patient's, in progress, at the selected facility; teeth and surfaces valid; each charted tooth appended.     |
| Propose treatment plan       | `POST /dental/treatment-plans`                                                      | Dentist; at least one item; each item's tooth/surfaces match the procedure's site; active procedure types.                                                                      |
| Add plan item                | `POST /dental/treatment-plans/:id/items`                                            | Dentist; open plan; the item awaits the patient's decision.                                                                                                                     |
| Record patient's decision    | `POST /dental/treatment-plans/:id/decision`                                         | Every item awaiting a decision is decided (listed ones accepted, others declined); a note is required; optimistic `version`.                                                    |
| Cancel plan item             | `POST /dental/treatment-plans/:id/items/:itemId/cancel`                             | Proposed or accepted items only; not the plan's last open item (decline or discontinue instead).                                                                                |
| Discontinue plan             | `POST /dental/treatment-plans/:id/discontinue`                                      | Accepted or in-progress plans; reason; open items are cancelled, completed ones stay.                                                                                           |
| Record procedure             | `POST /dental/patients/:patientId/procedures`                                       | Dentist; encounter in progress; site rules; a plan item must be accepted, of an active plan, same type and tooth. Chart effect applied to the tooth's current state (appended). |
| Add image                    | `POST /dental/patients/:patientId/images`                                           | The document is this patient's, uploaded (`available`), category `imaging`, an image or DICOM type; once per document.                                                          |
| Record periodontal chart     | `POST /dental/patients/:patientId/perio-charts`                                     | Dentist (`dental.chart.write`); encounter in progress at the selected facility; per tooth sites, measurements and furcation validated (see below).                              |
| Mark entered in error        | `POST /dental/{examinations,procedures,images,perio-charts}/:id/entered-in-error`   | Reason ≥ 5 characters. A procedure's plan item opens again; billing cancels its charge if not yet invoiced.                                                                     |
| Procedure catalog / notation | `POST/PATCH /dental/procedure-types`, `PUT /dental/facilities/:facilityId/notation` | Settings permission.                                                                                                                                                            |
| MyHealth dental records      | `PUT /dental/settings/portal` `{ portalDentalRecords, version }`                    | `dental.settings.manage`; `version` is the current setting's (0 when never set), else 409. Audited `dental.settings.portal` with before and after.                              |
| Supply template              | `PUT /dental/procedure-types/:id/supplies`                                          | Settings permission; active inventory items, each once, quantity 1–1000; an empty list clears it. See [supplies used](#supplies-used).                                          |
| Default supply location      | `PUT /dental/facilities/:facilityId/supply-location`                                | Settings permission; an active inventory location of that facility, or `null`.                                                                                                  |
| Record supplies used         | `POST /dental/procedures/:id/supplies`                                              | `dental.procedure.record`; procedure recorded, at the selected facility; issued by inventory in the same transaction; idempotent by `idempotencyKey`.                           |
| Return unused supplies       | `POST /dental/procedures/:id/supplies/returns`                                      | `dental.procedure.record`; issued lines of this procedure, never more than is still out, one location, reason; also after entered in error.                                     |

Examinations and procedures accept an `Idempotency-Key` header (the staff app sends one per form).

How a procedure changes the chart (`applyChartEffect`): a restoration or sealant covers the treated surfaces (caries
there is removed); a crown replaces caries, restorations, sealants and fractures; a root canal is added; an extraction
leaves the tooth missing; an implant or pontic replaces whatever was charted.

## Queries

- `GET /dental/patients/:patientId` — the dental record in one call: patient brief, facility notation, current chart
  (with the source and author of each tooth's state), examinations (newest 50, with the teeth each charted), plans,
  procedures, image list. Audited `dental.record.view`.
- `GET /dental/patients/:patientId/teeth/:tooth` — every state of one tooth, newest first, with corrected sources
  flagged. Audited `dental.tooth.history`.
- `GET /dental/visits?date=` — dentists' encounters at the selected facility on a local day (default today), with
  examination and procedure counts (the dental worklist). Audited.
- `GET /dental/treatment-plans/:id`, `GET /dental/settings`.
- `GET /dental/perio-charts/:id` — one periodontal chart with its measurements, summary and the changes since the
  patient's previous recorded chart. Audited `dental.perio.view`. The dental record lists every chart with its summary.
- `GET /dental/images/:id/link` — a 5-minute signed URL, audited by the documents service as `document.download`.
- `GET /dental/settings/portal` (`dental.record.read`) — whether MyHealth shows dental records, when and by whom it was
  last changed.
- Patient portal (`PatientAccessGuard`): `GET /portal/dental/availability`, `GET /portal/dental/record` — see
  [dental records in MyHealth](#dental-records-in-myhealth).
- `GET /dental/supplies/options` — supply templates, the organization's active inventory items and, with a selected
  facility, its active stock locations, usable stock per location and item, and the default location. The dental
  record (`GET /dental/patients/:patientId`) also carries `supplyUses` (issues with their lots and what is still out,
  returns).

## Events

Published (outbox; payloads carry ids and codes only): `DentalExaminationRecorded`, `DentalChartUpdated` (aggregate
`patient`; source and teeth), `DentalTreatmentPlanCreated`, `DentalTreatmentPlanAccepted`, `DentalProcedurePerformed`
(procedure code, plan item), `DentalProcedureEnteredInError`, `DentalPerioChartRecorded` (encounter, number of teeth),
`DentalSuppliesIssued` and `DentalSuppliesReturned` (aggregate `dental_procedure`; supply use, inventory movement group,
number of lines). Inventory records `InventoryStockLow` when an issue crosses a reorder level.

Consumed by billing (`ChargeCapture`): `DentalProcedurePerformed` captures a charge when a billing service maps the
procedure's code (`source_kind = 'dental_procedure'`, description "Composite restoration — 16 MO", service date the
facility-local day it was performed); `DentalProcedureEnteredInError` cancels that charge while it is not on an
invoice (an invoiced one needs a void, as for laboratory orders). Capture is idempotent per procedure.

## Permissions

| Permission                                            | Who (system roles)                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `dental.record.read`                                  | org_admin, dentist, dental_assistant, physician, nurse              |
| `dental.chart.write`                                  | org_admin, dentist                                                  |
| `dental.treatment-plan.manage`                        | org_admin, dentist                                                  |
| `dental.procedure.record`                             | org_admin, dentist                                                  |
| `dental.record.write` (corrections: entered in error) | org_admin, dentist                                                  |
| `dental.imaging.read`                                 | org_admin, dentist, dental_assistant                                |
| `dental.imaging.upload`                               | org_admin, dentist, dental_assistant (also needs `document.upload`) |
| `dental.settings.manage`                              | org_admin                                                           |

MyHealth dental records need no new permission: the setting uses `dental.settings.manage`; patients are authorized by
the portal's own guard.

New system roles (migration `0027`): **dentist** (a physician's clinical permissions — appointments, queue,
encounters, prescriptions, laboratory orders — plus dental ones) and **dental_assistant** (a nurse's plus the dental
record and imaging). Recording examinations, plans and procedures additionally requires the user to be linked to an
active practitioner with profession `dentist`.

## API

Endpoints above under `/api/v1/dental` (OpenAPI tag `dental`). Errors: `invalid_chart` (details per tooth),
`invalid_plan_item` / `invalid_procedure_site` (details), `encounter_not_in_progress`, `plan_item_not_accepted`,
`plan_item_mismatch`, `plan_item_completed` (409), `nothing_to_decide`, `last_item`, `plan_closed`,
`plan_not_active`, `not_an_image`, `document_unavailable`, `image_exists` (409), `already_entered_in_error`,
`procedure_code_exists` (409), `invalid_chart_effect`.

## Database relationships

Migration `0027_dental.sql` (`0041` periodontal charts, `0056` the MyHealth setting). Composite same-organization and same-patient foreign keys to `patient`, `facility`,
`practitioner`, `encounter (patient_id, id)` and `document`; tooth states reference their examination or procedure
by `(patient_id, id)`, so a state cannot belong to another patient's record. Triggers: `dental_record_guard`
(examinations, procedures, images: only `recorded → entered_in_error` with reason, author and time; no deletes),
`prevent_mutation` (tooth states and findings). The migration also widens billing's source kinds
(`billing_service.source_kind`, `billing_charge.source_type`) with `dental_procedure`.

Migration `0057_dental_supplies.sql`: `dental_supply_template_item` (procedure type, inventory item, quantity,
position), `dental_facility_setting.supply_location_id` (→ `inventory_location`), `dental_supply_use` (procedure by
`(patient_id, id)`, kind `issue | return`, location, reason for returns, inventory movement group, unique idempotency
key per organization) and `dental_supply_use_line` (inventory item, lot and movement, snapshot of item code, name,
stock unit, lot number and expiry, quantity; a return line names the issued line). Both are append-only
(`prevent_mutation`). The inventory's own tables gain the movement's source (`source_type`, `source_id`) and the kind
`return` in the same migration.

## Integration points

- **Clinic** (port `DentalContext`, adapter `apps/api/src/app/adapters/dental-adapters.ts`): the encounter (patient,
  facility, status), the actor's practitioner and profession, practitioner and staff names, patient briefs, and
  dentists' encounters per day (`ClinicQueries.encountersOfProfession`).
- **Billing**: `BillingSources.dentalProcedure` (adapter over `DentalProcedureService.billable`), events above.
- **Inventory** (port `DentalSupplies`, adapter `AppDentalSupplies` in `dental-adapters.ts` over `InventoryQueries` and
  `InventoryStockService.issueForSource` / `returnForSource`): items, locations, usable stock, and issues and returns
  inside dentistry's transaction.
- **Documents**: imaging files (upload through `POST /documents`, then linked; signed download links).
- **Prescriptions and laboratory**: through the encounter workspace of the dental visit (the dental record links to
  it as "Notes & prescriptions").
- **Staff app**: `/dental` (today's dental patients), `/dental/patients/[id]` (chart, charting an examination, tooth
  history, plans, procedures, examinations, imaging; starting a dental visit), `/dental/settings`; "Dental record" on
  the patient record; billing settings can map a service to a dental procedure. See
  [staff-app.md](../architecture/staff-app.md).
- **Patient portal**: `DentalPatientAccess` (exported by `DentalModule`) is read by
  `apps/api/src/app/portal/portal-dental.controller.ts`; MyHealth `/dental`. See
  [portal-app.md](../architecture/portal-app.md).

## Periodontal charting

A periodontal chart (`dental_perio_chart`, `dental_perio_tooth`, `dental_perio_site`; migration `0041`) is recorded by
a dentist during the patient's visit, like an examination, and is immutable (entered in error with a reason is the only
change: trigger `dental_record_guard`; teeth and sites are append-only).

- **Per site** — six sites per tooth: `MB`, `B`, `DB` (mesio-, mid-, disto-buccal/labial) and `ML`, `L`, `DL`
  (lingual, palatal on upper teeth): probing depth (0–20 mm), gingival margin relative to the CEJ (−10 to 20 mm:
  positive = recession, negative = margin coronal to the CEJ), bleeding on probing, plaque, suppuration. Any of them
  may be left out; a tooth not listed was not examined.
- **Per tooth** — mobility 0–3 (Miller) and furcation 0–3 (Glickman classes I–III), furcation only on teeth that have
  one (permanent molars, upper first premolars, primary molars; `libs/dental/src/lib/periodontal.rules.ts`).
- **Derived, never diagnostic** — clinical attachment level (probing depth + gingival margin), a summary (teeth, sites
  probed, bleeding and plaque percentages, sites ≥ 4 and ≥ 6 mm, deepest pocket, mean attachment level, suppuration,
  mobile and furcation-involved teeth) and, against the previous recorded chart, the sites whose depth changed by
  2 mm or more. The platform does **not** stage or grade periodontitis: that is the dentist's judgement, recorded in
  the visit's notes and diagnoses.
- **Staff** — "Periodontal charts" on the dental record: record (a row per tooth offered from the odontogram, missing
  and unerupted teeth left out), view a chart with the changes since the previous one, mark entered in error.

## Dental records in MyHealth

**Decision (the safest reasonable interpretation; change it with the clinics):** showing dental records to patients is
**opt-in per organization and off by default** (`/dental/settings`, "Dental records in MyHealth",
`dental.settings.manage`, audited, optimistic version). While it is off, MyHealth shows nothing dental: the
availability answer is `false`, the navigation has no Dental entry, and `GET /portal/dental/record` is refused (403,
audited `portal.dental-view` with outcome `denied`).

When it is on, the patient sees only what is patient-facing (`libs/dental/src/lib/portal/dental-patient-access.ts`, a
dedicated read model — staff shapes are never reused):

| Shown                                                                                                           | Fields                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Treatment plans** — presented to the patient, who decides each item, so already patient-facing (every status) | title, status, proposed and decided dates, dentist and facility name; per item: phase, tooth, surfaces, procedure name, status, decision |
| **Completed procedures** — recorded, never entered in error                                                     | date performed, tooth, surfaces, procedure name, dentist and facility name                                                               |
| **Current tooth chart** — the same derivation the staff see, so entered-in-error sources are already excluded   | per charted tooth: conditions with surfaces, date of the state                                                                           |

Never shown: examination notes and oral hygiene, tooth notes, plan and item notes, decision notes, discontinuation
and correction reasons, periodontal charts, images and radiographs (they would need an explicit per-image release),
procedure codes, staff users, and anything entered in error. **Plans carry no prices** (fees are billing's), so no
estimate is shown; MyHealth tells the patient to ask the clinic. Dates are the facility's local calendar dates.
Teeth are stored in FDI and shown in **one notation for the whole record** — that of the facility of the patient's
latest dental care (plan, procedure or examination) — so a tooth reads the same in every section.

- `GET /portal/dental/availability` — `{ available }`: records are shared **and** the patient has a plan, a recorded
  procedure or a charted tooth. A yes/no for the navigation without clinical content (like the unread-message count,
  not audited).
- `GET /portal/dental/record` — `{ notation, plans, procedures, chart }`; audited `portal.dental-view` with actor type
  `patient` and counts only. The patient guard re-checks session, account and `portal_access` consent on every call.
- MyHealth `/dental` (`apps/portal`): plans with each item's tooth (notation plus plain name), procedure, decision and
  status (icon, words and colour), treatments done, and a read-only odontogram summary (charted teeth by tone —
  no problems noted, treated, needs treatment, being watched, missing — with a key and a plain-language list; teeth not
  charted are dashed). Wording in `apps/portal/src/lib/dental.ts`. Patients cannot decide plan items in MyHealth; they
  are told to talk to the dentist.

## Supplies used

The supplies a procedure used are taken from inventory stock (`libs/dental/src/lib/supplies`, migration `0057`).

- **Templates (configuration)** — per procedure type, the inventory items and quantities usually used (e.g. anaesthetic
  cartridge × 1, composite × 1), in order; and per facility the stock location offered first. `dental.settings.manage`;
  audited `dental.supply-template.update` (before and after) and `dental.settings.supply-location`. Staff `/dental/settings`.
- **Recording use** — after a procedure is recorded (the staff app opens the procedure's "Supplies used" panel), staff
  confirm what was actually used: prefilled from the template, editable (add, remove, quantity), from a stock location
  of the procedure's facility (the selected facility). Controlled items need a reason and a reference. The request
  carries an idempotency key: a retry returns the recorded use; the same key for another request is refused
  (`idempotency_key_reused`). Further supplies can be recorded later as another use; none once the procedure is
  entered in error (`procedure_entered_in_error`).
- **One transaction across the two domains** — the platform is one database, so dentistry opens the transaction, locks
  the procedure row, and calls the `DentalSupplies` port with it; the API's adapter runs the inventory's own command
  (`InventoryStockService.issueForSource`) inside that transaction: location of the actor's facility and active, items
  active, lots first-expiry-first-out and never expired, balance rows locked and never negative, controlled items with
  reason and reference, ledger rows (`kind = issue`, `issued_to = 'Dental procedure'`, `source_type =
'dental_procedure'`, `source_id` = the procedure), inventory audit and `InventoryStockLow`. Dentistry then records the
  use and one line per lot issued (a FEFO issue may split an item across lots), audits `dental.supplies.issue` with the
  patient and procedure, and records `DentalSuppliesIssued`. Any refusal — `insufficient_stock` (details: item,
  usable quantity, quantity in expired lots), `controlled_item_details`, `location_other_facility`, `invalid_supplies` —
  rolls back everything: nothing is issued and nothing is recorded. Neither library imports the other.
- **Traceability** — the dental record lists each use with item, lot number and expiry, and what is still out; the lot
  lines are indexed by lot, so a material recall can find the procedures (and patients) that used a lot.
- **Entered in error and returns** — used material is consumed, so marking a procedure entered in error does **not**
  put anything back in stock. Unused supplies come back only through an explicit **return** (also after entered in
  error): chosen issued lines and quantities, a reason (and a reference for controlled items), back to the same lots at
  the location they were issued from (one location per return). Inventory posts `kind = return` movements with the
  same source and refuses to take back more than was issued to the procedure from that lot net of earlier returns
  (`return_exceeds_issued`); dentistry checks the same per issued line (`invalid_supply_return`). Audited
  `dental.supplies.return` (with the reason), event `DentalSuppliesReturned`.
- **Billing is unchanged** — supplies are not charged separately. An organization that charges for a material does so
  through its own price list (e.g. a billing service mapped to the procedure code); charging supplies from their use is
  a follow-up.
- **Permissions** — no new ones: templates and the default location need `dental.settings.manage`; recording use and
  returns need `dental.procedure.record` (dentists, organization administrators). Inventory's stock rules apply to the
  movement whatever the user's inventory permissions: the dental permission authorizes the clinical action, the
  inventory command enforces the stock rules.

## Open questions / assumptions

- Display notation per facility (FDI default) — confirm with target clinics.
- Procedure coding: the organization's own codes until a licensed code set or PhilHealth dental benefit codes are
  required and obtained.
- Orthodontic records and dental-specific consent forms are follow-ups. Periodontal charting is recorded by dentists
  only; a dental hygienist role, where clinics have one, is a follow-up.
- Images uploaded through the staff app are limited to 10 MB (the staff server relays the file); large CBCT studies
  need a direct-to-storage or PACS integration.
- MyHealth dental records are all-or-nothing per organization (not per facility, plan or patient) and show every plan
  status; confirm with the clinics. Releasing images, deciding plan items online and fee estimates are follow-ups.
- Supplies: dental assistants cannot record supply use (they lack `dental.procedure.record`); a narrower permission
  for them is a follow-up if clinics want it. Charging supplies separately and a recall search screen by lot are
  follow-ups.
