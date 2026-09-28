# Dental

## Purpose

Dentistry on the same Patient Master (Phase 6): the odontogram and its history, dental examinations, treatment plans
decided by the patient, performed procedures (which change the chart, complete plan items and are charged by
billing) and dental imaging. Library: `libs/dental` (`scope:dental`); rules in `libs/dental/CLAUDE.md`.

**A dental visit is a clinic encounter with a dentist.** Appointments, the queue, SOAP notes, diagnoses,
prescriptions (`libs/prescription` already allows dentists to prescribe) and laboratory orders reuse the clinic
workflow; this domain adds only what is specific to dentistry. There is no second patient table and no second
encounter model.

Not in scope yet: periodontal charting (probing depths, mobility, bleeding), orthodontic records, a patient-facing
view in MyHealth, dental FHIR resources, stock use of dental supplies (inventory), and a licensed procedure code set.

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
| Mark entered in error        | `POST /dental/{examinations,procedures,images}/:id/entered-in-error`                | Reason ≥ 5 characters. A procedure's plan item opens again; billing cancels its charge if not yet invoiced.                                                                     |
| Procedure catalog / notation | `POST/PATCH /dental/procedure-types`, `PUT /dental/facilities/:facilityId/notation` | Settings permission.                                                                                                                                                            |

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
- `GET /dental/images/:id/link` — a 5-minute signed URL, audited by the documents service as `document.download`.

## Events

Published (outbox; payloads carry ids and codes only): `DentalExaminationRecorded`, `DentalChartUpdated` (aggregate
`patient`; source and teeth), `DentalTreatmentPlanCreated`, `DentalTreatmentPlanAccepted`, `DentalProcedurePerformed`
(procedure code, plan item), `DentalProcedureEnteredInError`.

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

Migration `0027_dental.sql`. Composite same-organization and same-patient foreign keys to `patient`, `facility`,
`practitioner`, `encounter (patient_id, id)` and `document`; tooth states reference their examination or procedure
by `(patient_id, id)`, so a state cannot belong to another patient's record. Triggers: `dental_record_guard`
(examinations, procedures, images: only `recorded → entered_in_error` with reason, author and time; no deletes),
`prevent_mutation` (tooth states and findings). The migration also widens billing's source kinds
(`billing_service.source_kind`, `billing_charge.source_type`) with `dental_procedure`.

## Integration points

- **Clinic** (port `DentalContext`, adapter `apps/api/src/app/adapters/dental-adapters.ts`): the encounter (patient,
  facility, status), the actor's practitioner and profession, practitioner and staff names, patient briefs, and
  dentists' encounters per day (`ClinicQueries.encountersOfProfession`).
- **Billing**: `BillingSources.dentalProcedure` (adapter over `DentalProcedureService.billable`), events above.
- **Documents**: imaging files (upload through `POST /documents`, then linked; signed download links).
- **Prescriptions and laboratory**: through the encounter workspace of the dental visit (the dental record links to
  it as "Notes & prescriptions").
- **Staff app**: `/dental` (today's dental patients), `/dental/patients/[id]` (chart, charting an examination, tooth
  history, plans, procedures, examinations, imaging; starting a dental visit), `/dental/settings`; "Dental record" on
  the patient record; billing settings can map a service to a dental procedure. See
  [staff-app.md](../architecture/staff-app.md).

## Open questions / assumptions

- Display notation per facility (FDI default) — confirm with target clinics.
- Procedure coding: the organization's own codes until a licensed code set or PhilHealth dental benefit codes are
  required and obtained.
- Periodontal charting, orthodontic records and dental-specific consent forms are follow-ups.
- Images uploaded through the staff app are limited to 10 MB (the staff server relays the file); large CBCT studies
  need a direct-to-storage or PACS integration.
- MyHealth does not show dental records yet; releasing plans or charts to patients needs a decision on what is
  patient-facing.
