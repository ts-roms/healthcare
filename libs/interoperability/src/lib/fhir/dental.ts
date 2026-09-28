import type { CodeableConcept, Observation, ObservationComponent, Procedure } from "fhir/r4";
import type { DentalChartToothSource, DentalPerioChartSource, DentalProcedureSource, FhirContext } from "./sources";
import { compact, localSystem, ref } from "./support";
import { SYSTEMS } from "./terminology";

/**
 * Dental record → FHIR R4 (docs/interoperability/fhir.md#dental). Teeth are FDI / ISO 3950 codes in a local code
 * system: HL7's tooth and surface code systems are published as examples, so neither is claimed. Procedure and finding codes are the organization's own. Measurements only; nothing is a diagnosis.
 */

const TYPES = ["central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
const PRIMARY_TYPES = ["central incisor", "lateral incisor", "canine", "first molar", "second molar"];

/** e.g. "16" → "upper right first molar", "75" → "lower left primary second molar". */
export function fdiToothName(tooth: string): string {
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  const primary = quadrant > 4;
  const q = primary ? quadrant - 4 : quadrant;
  const type = (primary ? PRIMARY_TYPES : TYPES)[position - 1] ?? "tooth";
  return `${q <= 2 ? "upper" : "lower"} ${q === 1 || q === 4 ? "right" : "left"} ${primary ? "primary " : ""}${type}`;
}

const SURFACE_NAMES: Record<string, string> = { M: "mesial", D: "distal", O: "occlusal", I: "incisal", B: "buccal/facial", L: "lingual/palatal" };
const FINDING_NAMES: Record<string, string> = {
  caries: "Caries",
  restoration: "Restoration",
  sealant: "Sealant",
  fracture: "Fracture",
  crown: "Crown",
  root_canal: "Root canal treated",
  missing: "Missing tooth",
  implant: "Implant",
  pontic: "Pontic",
  impacted: "Impacted tooth",
  unerupted: "Unerupted tooth",
  watch: "Watch",
};
const PERIO_SITE_NAMES: Record<string, string> = {
  MB: "mesio-buccal",
  B: "mid-buccal",
  DB: "disto-buccal",
  ML: "mesio-lingual",
  L: "mid-lingual",
  DL: "disto-lingual",
};

export function toothConcept(ctx: FhirContext, tooth: string): CodeableConcept {
  return { coding: [{ system: localSystem(ctx, "codesystem/fdi-tooth"), code: tooth, display: fdiToothName(tooth) }], text: `Tooth ${tooth} (FDI)` };
}

function surfaceConcept(ctx: FhirContext, surface: string): CodeableConcept {
  const display = SURFACE_NAMES[surface] ?? surface;
  return { coding: [{ system: localSystem(ctx, "codesystem/tooth-surface"), code: surface, display }], text: `${display} surface` };
}

const EXAM_CATEGORY: CodeableConcept = { coding: [{ system: SYSTEMS.observationCategory, code: "exam", display: "Exam" }] };

/** A performed procedure; entered-in-error ones stay visible as such. */
export function toDentalProcedure(ctx: FhirContext, patientId: string, p: DentalProcedureSource): Procedure {
  return compact<Procedure>({
    resourceType: "Procedure",
    id: p.id,
    // Reliable: a procedure is immutable once recorded; marking it entered in error records its time.
    meta: { lastUpdated: p.enteredInErrorAt ?? p.performedAt },
    status: p.status === "entered_in_error" ? "entered-in-error" : "completed",
    category: { text: "Dental procedure" },
    code: { coding: [{ system: localSystem(ctx, "codesystem/dental-procedure"), code: p.code, display: p.name }], text: p.name },
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", p.encounterId),
    performedDateTime: p.performedAt,
    performer: [{ actor: ref("Practitioner", p.practitionerId) }],
    location: ref("Location", p.facilityId),
    bodySite: p.tooth ? [toothConcept(ctx, p.tooth), ...p.surfaces.map((s) => surfaceConcept(ctx, s))] : undefined,
    note: p.notes ? [{ text: p.notes }] : undefined,
  });
}

/**
 * The current chart as one Observation per finding on a tooth (e.g. caries on 16, with its surfaces as components).
 * A tooth charted sound has no finding and no Observation. A finding left by a procedure is `partOf` it.
 */
export function toDentalFindingObservations(ctx: FhirContext, patientId: string, t: DentalChartToothSource): Observation[] {
  return t.findings.map((f) =>
    compact<Observation>({
      resourceType: "Observation",
      id: `${t.source.id}-${t.tooth}-${f.condition.replace(/_/g, "-")}`,
      status: "final",
      category: [EXAM_CATEGORY],
      code: {
        coding: [{ system: localSystem(ctx, "codesystem/dental-finding"), code: f.condition, display: FINDING_NAMES[f.condition] ?? f.condition }],
        text: FINDING_NAMES[f.condition] ?? f.condition,
      },
      subject: ref("Patient", patientId),
      effectiveDateTime: t.recordedAt,
      partOf: t.source.type === "procedure" ? [ref("Procedure", t.source.id)] : undefined,
      bodySite: toothConcept(ctx, t.tooth),
      component: f.surfaces.map((s) => ({
        code: { coding: [{ system: localSystem(ctx, "codesystem/dental-observation"), code: "surface", display: "Tooth surface" }] },
        valueCodeableConcept: surfaceConcept(ctx, s),
      })),
    }),
  );
}

/**
 * A periodontal chart as one Observation per examined tooth: per site probing depth and gingival margin (mm, UCUM),
 * bleeding, plaque and suppuration, and the tooth's mobility and furcation grades, as components.
 */
export function toPerioObservations(ctx: FhirContext, patientId: string, chart: DentalPerioChartSource): Observation[] {
  const measure = (code: string, display: string) => ({ coding: [{ system: localSystem(ctx, "codesystem/periodontal-measure"), code, display }] });
  const mm = (value: number) => ({ value, unit: "mm", system: SYSTEMS.ucum, code: "mm" });
  return chart.teeth.map((t) => {
    const component: ObservationComponent[] = [];
    for (const s of t.sites) {
      const name = PERIO_SITE_NAMES[s.site] ?? s.site;
      if (s.probingDepth !== null) component.push({ code: measure(`probing-depth-${s.site}`, `Probing depth, ${name}`), valueQuantity: mm(s.probingDepth) });
      if (s.gingivalMargin !== null) {
        component.push({ code: measure(`gingival-margin-${s.site}`, `Gingival margin (+ recession), ${name}`), valueQuantity: mm(s.gingivalMargin) });
      }
      component.push({ code: measure(`bleeding-${s.site}`, `Bleeding on probing, ${name}`), valueBoolean: s.bleeding });
      component.push({ code: measure(`plaque-${s.site}`, `Plaque, ${name}`), valueBoolean: s.plaque });
      component.push({ code: measure(`suppuration-${s.site}`, `Suppuration, ${name}`), valueBoolean: s.suppuration });
    }
    if (t.mobility !== null) component.push({ code: measure("mobility", "Tooth mobility (Miller 0–3)"), valueInteger: t.mobility });
    if (t.furcation !== null) component.push({ code: measure("furcation", "Furcation involvement (0–3)"), valueInteger: t.furcation });
    return compact<Observation>({
      resourceType: "Observation",
      id: `${chart.id}-${t.tooth}`,
      status: chart.status === "entered_in_error" ? "entered-in-error" : "final",
      category: [EXAM_CATEGORY],
      code: {
        coding: [{ system: localSystem(ctx, "codesystem/dental-observation"), code: "periodontal-charting", display: "Periodontal charting of one tooth" }],
        text: "Periodontal charting",
      },
      subject: ref("Patient", patientId),
      encounter: ref("Encounter", chart.encounterId),
      effectiveDateTime: chart.recordedAt,
      performer: [ref("Practitioner", chart.practitionerId)],
      bodySite: toothConcept(ctx, t.tooth),
      component,
    });
  });
}
