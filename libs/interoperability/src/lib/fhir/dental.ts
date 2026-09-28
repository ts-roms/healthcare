import type { CarePlan, CarePlanActivity, CodeableConcept, Coding, Observation, ObservationComponent, Procedure } from "fhir/r4";
import type {
  DentalExaminationSource,
  DentalImageSource,
  DentalPerioChartSource,
  DentalPlanSource,
  DentalProcedureSource,
  DentalRecordSource,
  DentalToothStateSource,
  FhirContext,
} from "./sources";
import { codeSystem, compact, concept, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

/**
 * The dental record (libs/dental) as base FHIR R4 resources. No licensed dental code set (CDT/ADA, SNOMED CT body
 * structures, PhilHealth dental benefit codes) is on record, so every code here is the platform's own, in a local code
 * system under `FhirContext.identifierBase` — each key can be pointed at another URI with `FHIR_CODE_SYSTEMS` only when
 * the stored codes ARE that system's codes (e.g. an organization whose procedure catalog uses a licensed code set):
 *
 * | key                  | codes                                                                                   |
 * | -------------------- | --------------------------------------------------------------------------------------- |
 * | `dental-procedure`   | the organization's procedure catalog codes                                              |
 * | `fdi-tooth`          | FDI / ISO 3950 two-digit tooth codes (11–48, primary 51–85)                             |
 * | `tooth-surface`      | M, D, O, I, B, L                                                                        |
 * | `tooth-condition`    | the charted conditions (caries, restoration, …) and `sound`                             |
 * | `dental-observation` | what the platform observes: tooth state, examination, oral hygiene, periodontal values |
 * | `oral-hygiene`       | good, fair, poor                                                                        |
 * | `dental-image-kind`  | periapical, bitewing, panoramic, …                                                      |
 *
 * Records in error follow the platform's rule: exported with the `entered-in-error` status. The current chart is
 * derived, so tooth states of a corrected examination or procedure are simply no longer part of it.
 */
export const DENTAL_CODE_SYSTEMS = {
  procedure: "dental-procedure",
  tooth: "fdi-tooth",
  surface: "tooth-surface",
  condition: "tooth-condition",
  observation: "dental-observation",
  oralHygiene: "oral-hygiene",
  imageKind: "dental-image-kind",
} as const;

const SURFACE_DISPLAY: Record<string, string> = {
  M: "Mesial",
  D: "Distal",
  O: "Occlusal",
  I: "Incisal",
  B: "Buccal / facial",
  L: "Lingual / palatal",
};

const CONDITION_DISPLAY: Record<string, string> = {
  sound: "Sound",
  caries: "Caries",
  restoration: "Restoration",
  sealant: "Sealant",
  fracture: "Fracture",
  crown: "Crown",
  root_canal: "Root canal treated",
  missing: "Missing",
  implant: "Implant",
  pontic: "Pontic",
  impacted: "Impacted",
  unerupted: "Unerupted",
  watch: "Watch",
};

const PERIO_SITE_DISPLAY: Record<string, string> = {
  MB: "mesio-buccal",
  B: "mid-buccal",
  DB: "disto-buccal",
  ML: "mesio-lingual",
  L: "mid-lingual",
  DL: "disto-lingual",
};

export const DENTAL_IMAGE_KIND_DISPLAY: Record<string, string> = {
  periapical: "Periapical radiograph",
  bitewing: "Bitewing radiograph",
  panoramic: "Panoramic radiograph",
  cephalometric: "Cephalometric radiograph",
  occlusal: "Occlusal radiograph",
  cbct: "Cone-beam CT",
  intraoral_photo: "Intraoral photograph",
  extraoral_photo: "Extraoral photograph",
  other: "Other dental image",
};

const humanize = (code: string) => code.replace(/_/g, " ");

function local(ctx: FhirContext, key: keyof typeof DENTAL_CODE_SYSTEMS, code: string, display: string): Coding {
  return { system: codeSystem(ctx, DENTAL_CODE_SYSTEMS[key]), code, display };
}

/** The organization's own procedure code. */
function procedureCode(ctx: FhirContext, code: string, name: string): CodeableConcept {
  return concept(local(ctx, "procedure", code, name), name);
}

function observationCode(ctx: FhirContext, code: string, display: string): CodeableConcept {
  return concept(local(ctx, "observation", code, display), display);
}

export function toothConcept(ctx: FhirContext, tooth: string): CodeableConcept {
  return concept(local(ctx, "tooth", tooth, `Tooth ${tooth}`), `Tooth ${tooth} (FDI)`);
}

function surfaceConcept(ctx: FhirContext, tooth: string, surface: string): CodeableConcept {
  const display = SURFACE_DISPLAY[surface] ?? surface;
  return concept(local(ctx, "surface", surface, display), `Tooth ${tooth}, ${display.toLowerCase()} surface`);
}

function conditionConcept(ctx: FhirContext, condition: string): CodeableConcept {
  const display = CONDITION_DISPLAY[condition] ?? humanize(condition);
  return concept(local(ctx, "condition", condition, display), display);
}

/** The procedure's site: the tooth, then each treated surface (a mouth-level procedure has none). */
function sites(ctx: FhirContext, tooth: string | null, surfaces: string[]): CodeableConcept[] {
  return tooth ? [toothConcept(ctx, tooth), ...surfaces.map((s) => surfaceConcept(ctx, tooth, s))] : [];
}

/** "tooth 16 MO" (FDI), as in the dental record's labels. */
function siteLabel(tooth: string | null, surfaces: string[]): string {
  return tooth ? ` — tooth ${tooth}${surfaces.length ? ` ${surfaces.join("")}` : ""}` : "";
}

const EXAM = concept({ system: SYSTEMS.observationCategory, code: "exam", display: "Exam" });
const RECORD_STATUS = { recorded: "final", entered_in_error: "entered-in-error" } as const;

/**
 * A performed dental procedure. Reliable last-updated time: a procedure is immutable except for being marked entered
 * in error (database trigger). The code's display is the catalog's current name (the code itself never changes).
 */
export function toDentalProcedure(ctx: FhirContext, patientId: string, p: DentalProcedureSource): Procedure {
  return compact<Procedure>({
    resourceType: "Procedure",
    id: p.id,
    meta: { lastUpdated: p.enteredInErrorAt ?? p.performedAt },
    basedOn: p.planId ? [ref("CarePlan", p.planId)] : undefined,
    status: p.status === "entered_in_error" ? "entered-in-error" : "completed",
    category: text("Dental procedure"),
    code: procedureCode(ctx, p.code, p.name),
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", p.encounterId),
    performedDateTime: p.performedAt,
    performer: [{ actor: ref("Practitioner", p.practitionerId) }],
    location: ref("Location", p.facilityId),
    bodySite: sites(ctx, p.tooth, p.surfaces),
    note: p.notes ? [{ text: p.notes }] : undefined,
  });
}

const PLAN_STATUS = {
  proposed: "draft",
  accepted: "active",
  in_progress: "active",
  completed: "completed",
  declined: "revoked",
  discontinued: "revoked",
} as const;

const ITEM_STATUS = { proposed: "not-started", accepted: "not-started", declined: "cancelled", completed: "completed", cancelled: "cancelled" } as const;
const ITEM_REASON: Partial<Record<DentalPlanSource["items"][number]["status"], string>> = {
  proposed: "Awaiting the patient's decision",
  accepted: "Accepted by the patient",
  declined: "Declined by the patient",
  cancelled: "Cancelled",
};

/**
 * A dental treatment plan: one activity per item (the procedure code, what it treats in the description, the
 * patient's decision as the status reason, the performed Procedure as the outcome). A plan awaiting the patient's
 * decision is a `draft`; declined and discontinued plans are `revoked`, saying which in a note. No prices: fees are
 * billing's.
 */
export function toDentalCarePlan(ctx: FhirContext, patientId: string, plan: DentalPlanSource): CarePlan {
  const notes = [
    plan.status === "proposed" ? { text: "Proposed; awaiting the patient's decision." } : undefined,
    plan.status === "declined" ? { text: "Declined by the patient." } : undefined,
    plan.status === "discontinued" ? { text: `Discontinued${plan.discontinuedReason ? `: ${plan.discontinuedReason}` : "."}` } : undefined,
    plan.decisionNote ? compact({ text: `Patient's decision: ${plan.decisionNote}`, time: plan.decidedAt ?? undefined }) : undefined,
  ].filter((n): n is { text: string; time?: string } => Boolean(n));
  return compact<CarePlan>({
    resourceType: "CarePlan",
    id: plan.id,
    status: PLAN_STATUS[plan.status],
    intent: "plan",
    category: [text("dental")],
    title: plan.title,
    description: plan.notes ?? undefined,
    subject: ref("Patient", patientId),
    created: plan.createdAt,
    author: ref("Practitioner", plan.practitionerId),
    activity: plan.items.map((item): CarePlanActivity =>
      compact<CarePlanActivity>({
        outcomeReference: item.procedureId ? [ref("Procedure", item.procedureId)] : undefined,
        detail: compact({
          kind: "ServiceRequest" as const,
          code: procedureCode(ctx, item.code, item.name),
          status: ITEM_STATUS[item.status],
          statusReason: ITEM_REASON[item.status] ? text(ITEM_REASON[item.status]!) : undefined,
          description: `Phase ${item.phase}: ${item.name}${siteLabel(item.tooth, item.surfaces)}${item.note ? `. ${item.note}` : ""}`,
        }),
      }),
    ),
    note: notes,
  });
}

/** A dental examination: oral hygiene as a component, the findings in the notes; the teeth it charted are tooth-state Observations. */
export function toDentalExamination(ctx: FhirContext, patientId: string, e: DentalExaminationSource): Observation {
  const hygiene = e.oralHygiene ? { good: "Good", fair: "Fair", poor: "Poor" }[e.oralHygiene] : undefined;
  return compact<Observation>({
    resourceType: "Observation",
    id: e.id,
    meta: { lastUpdated: e.enteredInErrorAt ?? e.recordedAt },
    status: RECORD_STATUS[e.status],
    category: [EXAM],
    code: observationCode(ctx, "dental-examination", "Dental examination"),
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", e.encounterId),
    effectiveDateTime: e.recordedAt,
    performer: [ref("Practitioner", e.practitionerId)],
    note: e.notes ? [{ text: e.notes }] : undefined,
    component:
      e.oralHygiene && hygiene
        ? [
            {
              code: observationCode(ctx, "oral-hygiene", "Oral hygiene"),
              valueCodeableConcept: concept(local(ctx, "oralHygiene", e.oralHygiene, hygiene), hygiene),
            },
          ]
        : undefined,
  });
}

/**
 * One tooth of the current chart: bodySite the tooth; a sound tooth has the value `sound`, otherwise one component per
 * finding and surface (the condition as the code, the surface as the value; a whole-tooth finding has `true`). Linked
 * to the examination Observation it was charted in (`derivedFrom`) or the Procedure that left it (`partOf`).
 */
export function toDentalToothState(ctx: FhirContext, patientId: string, s: DentalToothStateSource): Observation {
  const components = s.findings.flatMap((f): ObservationComponent[] =>
    f.surfaces.length
      ? f.surfaces.map((surface) => ({ code: conditionConcept(ctx, f.condition), valueCodeableConcept: surfaceConcept(ctx, s.tooth, surface) }))
      : [{ code: conditionConcept(ctx, f.condition), valueBoolean: true }],
  );
  return compact<Observation>({
    resourceType: "Observation",
    id: s.id,
    // Reliable: tooth states are append-only (database trigger).
    meta: { lastUpdated: s.recordedAt },
    partOf: s.source.type === "procedure" ? [ref("Procedure", s.source.id)] : undefined,
    status: "final",
    category: [EXAM],
    code: observationCode(ctx, "tooth-state", "Tooth state (odontogram)"),
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", s.encounterId),
    effectiveDateTime: s.recordedAt,
    performer: [ref("Practitioner", s.practitionerId)],
    valueCodeableConcept: s.findings.length ? undefined : conditionConcept(ctx, "sound"),
    note: s.note ? [{ text: s.note }] : undefined,
    bodySite: toothConcept(ctx, s.tooth),
    derivedFrom: s.source.type === "examination" ? [ref("Observation", s.source.id)] : undefined,
    component: components,
  });
}

function mm(value: number) {
  return { value, unit: "mm", system: SYSTEMS.ucum, code: "mm" };
}

/**
 * A periodontal chart: a panel Observation (`hasMember`) and one Observation per examined tooth (bodySite the tooth)
 * whose components are the tooth's mobility and furcation and, per site, the probing depth, gingival margin (mm from
 * the CEJ, positive = recession), bleeding on probing, plaque and suppuration — local codes that name the site, e.g.
 * `probing-depth-MB`. Values are exported as recorded (bleeding, plaque and suppuration are recorded as present or
 * not); derived values (attachment level, summaries) are not: they follow from these.
 */
export function toDentalPerioChart(ctx: FhirContext, patientId: string, chart: DentalPerioChartSource): Observation[] {
  const common = {
    meta: { lastUpdated: chart.enteredInErrorAt ?? chart.recordedAt },
    status: RECORD_STATUS[chart.status],
    category: [EXAM],
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", chart.encounterId),
    effectiveDateTime: chart.recordedAt,
    performer: [ref("Practitioner", chart.practitionerId)],
  } satisfies Partial<Observation>;
  const panel = compact<Observation>({
    resourceType: "Observation",
    id: chart.id,
    ...common,
    code: observationCode(ctx, "periodontal-chart", "Periodontal chart"),
    note: chart.notes ? [{ text: chart.notes }] : undefined,
    hasMember: chart.teeth.map((t) => ref("Observation", t.id)),
  });
  const teeth = chart.teeth.map((t) => {
    const components: ObservationComponent[] = [];
    if (t.mobility !== null) components.push({ code: observationCode(ctx, "tooth-mobility", "Tooth mobility (Miller)"), valueInteger: t.mobility });
    if (t.furcation !== null) components.push({ code: observationCode(ctx, "furcation", "Furcation involvement (Glickman)"), valueInteger: t.furcation });
    for (const s of t.sites) {
      const where = PERIO_SITE_DISPLAY[s.site] ?? s.site;
      const code = (measure: string, display: string) => observationCode(ctx, `${measure}-${s.site}`, `${display}, ${where}`);
      if (s.probingDepth !== null) components.push({ code: code("probing-depth", "Probing depth"), valueQuantity: mm(s.probingDepth) });
      if (s.gingivalMargin !== null) components.push({ code: code("gingival-margin", "Gingival margin from CEJ"), valueQuantity: mm(s.gingivalMargin) });
      components.push({ code: code("bleeding-on-probing", "Bleeding on probing"), valueBoolean: s.bleeding });
      components.push({ code: code("plaque", "Plaque"), valueBoolean: s.plaque });
      components.push({ code: code("suppuration", "Suppuration"), valueBoolean: s.suppuration });
    }
    return compact<Observation>({
      resourceType: "Observation",
      id: t.id,
      ...common,
      code: observationCode(ctx, "periodontal-tooth", "Periodontal measurements of a tooth"),
      bodySite: toothConcept(ctx, t.tooth),
      component: components,
    });
  });
  return [panel, ...teeth];
}

/** Every resource of the dental record: Procedures, CarePlans, and Observations (examinations, current chart, periodontal charts). */
export function dentalResources(ctx: FhirContext, patientId: string, dental: DentalRecordSource): Array<Procedure | CarePlan | Observation> {
  return [
    ...dental.procedures.map((p) => toDentalProcedure(ctx, patientId, p)),
    ...dental.plans.map((p) => toDentalCarePlan(ctx, patientId, p)),
    ...dental.examinations.map((e) => toDentalExamination(ctx, patientId, e)),
    ...dental.chart.map((s) => toDentalToothState(ctx, patientId, s)),
    ...dental.perioCharts.flatMap((c) => toDentalPerioChart(ctx, patientId, c)),
  ];
}

/** What a dental image adds to its DocumentReference: the kind as category, the teeth in the description, the visit and date taken as context. */
export function dentalImageKind(ctx: FhirContext, image: DentalImageSource): CodeableConcept {
  const display = DENTAL_IMAGE_KIND_DISPLAY[image.kind] ?? humanize(image.kind);
  return concept(local(ctx, "imageKind", image.kind, display), display);
}
