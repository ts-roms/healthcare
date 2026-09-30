# Immunizations

## Purpose

The patient's immunization history as one longitudinal record: doses **given here** (optionally taken from vaccine
stock), doses **not given** with the clinician's reason, doses **reported** by the patient or another provider (a
vaccination card, the patient's recall), and doses **accepted from a FHIR import**. It also holds the organization's own
**vaccine catalogue**.

The platform records what was given; it does **not** decide what is due. There is no built-in schedule, vaccine list,
dose interval, catch-up rule, age rule or contraindication logic, and no reminder is computed from the catalogue's
"doses in series" (reference only). Official schedules (e.g. the DOH National Immunization Program), national
immunization registry reporting and official vaccine code sets are dependencies
([integration dependencies](../interoperability/dependencies.md), [compliance register](../security/compliance-dependencies.md)).

**Placement.** Immunizations live in `libs/clinic` (`src/lib/immunizations`): a dose is clinical care given at a
facility, often within a consultation (`encounter_id`), next to allergies (a reaction may lead to recording one) and the
clinic's triage and encounter workflow. A separate library would have needed ports back into the clinic for
encounters and practitioners. Stock, staff names and documents are reached through the `ImmunizationContext` port and
the shared documents service.

## Entities

- **`immunization_vaccine`** (organization) — name, optional product/brand and manufacturer, optional code with a
  code-system key (`vaccine` for the organization's own list by default; an organization licensed to use an official
  set names its key and configures the URI in `FHIR_CODE_SYSTEMS`), route and site options (when listed, a dose given
  here must use one of them), doses in series as the organization records it (informational), active/inactive,
  optimistic version. One active entry per name and product, and per code.
- **`immunization`** (patient) — immutable record:
  - vaccine: catalogue id (required for doses given here; optional for reported ones) and a snapshot of name, product,
    manufacturer and code (for imports, as the sender named and coded it);
  - dose as recorded (`dose_label`, `dose_number`) — nothing is derived from it;
  - when: `occurrence_date` + `occurrence_precision` (`year` stored as 1 January, `month` as its first day, `day`,
    `time` with `occurred_at`); doses given here are a day or a time, never in the future;
  - `status` `completed` | `not_done` (reason `refused` | `contraindicated` | `unavailable` | `other` with the
    clinician's words, required for `other`; nothing given, no lot, no stock, no reaction);
  - `source` `administered_here` (facility, optional encounter, performer = the recording staff member and their
    practitioner record, lot number **required** when given, expiry **not before the day given**, route, site, amount
    and unit, stock item/location/quantity/movement group) | `historical` (where the information comes from —
    required —, given by/where as reported, optional lot, optional scan: a document of the patient) |
    `external_import` (import reference `fhir-import:<id>#<entry>`, declared source);
  - staff notes (never shown to the patient or exported), adverse reaction (added at recording or once later),
    entered in error (reason, by, at; the stock return group when stock was taken).

Invariants are database-enforced (migration `0081`): composite same-organization FKs (patient, facility, encounter,
vaccine, practitioner, inventory item and location, document), check constraints for every rule above, and
`immunization_guard`: no DELETE, no change except marking entered in error once (with the stock return) and adding a
reaction once while not in error. New records are refused under a merged patient record (`PM001` → `422
patient_merged`, ADR-0009).

## Commands

| Command                 | Preconditions                                                                                                                          | Result                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Add / update vaccine    | `clinic.configure`; update with `version`                                                                                              | Catalogue entry; audited `immunization.catalog.create` / `.update` (with changes)                                         |
| Record dose given here  | `immunization.record`, selected facility; active vaccine; encounter (if any) is this patient's, at this facility, not in error         | `ImmunizationRecorded`; audited `immunization.record`. With `stock`, the lot is taken in the same transaction (see below) |
| Record dose not given   | as above, with a reason                                                                                                                | Same event and audit, `status = not_done`                                                                                 |
| Record reported dose    | `immunization.record`; catalogue vaccine or reported name; `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; source description; scan of this patient | Same event and audit, `source = historical`                                                                               |
| Accept an imported dose | FHIR import review (`interop.fhir.import.review`), patient matched                                                                     | `recordImportedIn` in the review transaction; `source = external_import`; same event and audit                            |
| Add a reaction          | `immunization.record`; dose given, not in error, no reaction yet                                                                       | Audited `immunization.reaction`. Not an allergy: the screen links to recording one, never creates it                      |
| Mark entered in error   | `immunization.record`, a reason (3–500)                                                                                                | Stock taken for it goes back to the same lot, once; `ImmunizationEnteredInError`; audited `immunization.entered-in-error` |

**Stock (optional per dose).** A facility that keeps vaccines as inventory items of category `vaccine` (migration
`0081`) chooses the very lot given (`GET /immunizations/stock` lists unexpired lots per location). The dose is taken
through `InventoryStockService.consume` inside the recording transaction (movement source `immunization`, once per
record, database-enforced; only the clinic's `VACCINE_CATEGORIES`), and the stock lot's number and expiry become the
record's (a different typed lot is refused, `lot_mismatch`). Recording without stock stays possible (the lot number is
then typed). Entered in error returns it with `restore` (once).

## Queries

- `GET /patients/:id/immunizations` — history of the patient and records merged into it (`patientId` says which),
  newest first, entries in error included and marked; audited `immunization.view`.
- `GET /encounters/:id/immunizations` — doses recorded in a consultation.
- Read models for composition (not audited; the caller audits): `patientRecord` (FHIR, copy of the record),
  `workspace` (Patient 360), `timeline`, `patientView` (MyHealth).

## Events

`ImmunizationRecorded` { immunizationId, vaccineId, encounterId, source, status } and `ImmunizationEnteredInError`
{ immunizationId, stockReturned } — outbox, ids only. No consumer yet (registry reporting is a dependency).

## Permissions

| Permission            | Roles (system)                                        | Scope                                                  |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `immunization.read`   | org_admin, physician, nurse, dentist, records_officer | Organization                                           |
| `immunization.record` | org_admin, physician, nurse                           | Organization (doses given here: the selected facility) |
| `clinic.configure`    | org_admin                                             | Vaccine catalogue                                      |

Midwives and pharmacists who vaccinate get `immunization.record` through the organization's own roles (whether they
may is a matter of their licence and the facility's policy, not encoded).

## API

`/api/v1/immunizations/catalog` (GET `immunization.read`, `?includeInactive=true`; POST and PATCH `clinic.configure`),
`/immunizations/stock` (GET), `/patients/:id/immunizations` (GET; POST — given or not given here),
`/patients/:id/immunizations/historical` (POST), `/encounters/:id/immunizations` (GET),
`/immunizations/:id/reaction` and `/immunizations/:id/entered-in-error` (POST), `/portal/immunizations` (MyHealth).

## Composition

- **Timeline** kind `immunization` (`immunization.read`): "Immunization given / not given / reported / imported:
  vaccine", dose and the date given when partial; at the time given (with a time) or when recorded; entries in error
  marked; no notes, reasons or reactions ([patient timeline](patient-timeline.md)).
- **Patient 360** panel `immunizations` (withheld without `immunization.read`): latest 8 not in error, whether a
  reaction is recorded ([Patient 360](patient-360.md)).
- **FHIR R4** `Immunization` in `$everything` and `Immunization?patient=` (with `_lastUpdated`), and accepted from
  imports ([FHIR](../interoperability/fhir.md)).
- **MyHealth** `/immunizations`: doses given (here, reported, imported) by vaccine, with the date at its precision and
  where; never doses not given, entries in error, notes or lot details ([portal app](../architecture/portal-app.md)).
- **Copy of the record**: section `immunizations` ([records requests](records-requests.md)).

## Integration points

`ImmunizationContext` (`apps/api/src/app/adapters/immunization-adapters.ts`): staff names (auth), vaccine lots,
take/return stock (inventory). FHIR imports reach `ImmunizationService.recordImportedIn` through
`FhirImportTargets.recordImmunization`.

## Open questions / assumptions

- No schedule or due-dose logic; reminders for vaccines, if wanted, are care-plan activities the clinician sets.
- One dose takes one stock unit of one lot by default (a multi-dose vial is the facility's stock unit decision).
- Vaccine codes are the organization's own; CVX or a Philippine code set requires a licence or an official source.
- National immunization registry reporting (and any DOH form) is a dependency; nothing is sent.
- A reported dose's date is as precise as the source; the platform does not guess a day.
