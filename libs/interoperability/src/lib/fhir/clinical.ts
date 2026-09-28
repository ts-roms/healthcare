import type { AllergyIntolerance, Appointment, Condition, Encounter, Observation, ObservationComponent, Quantity } from "fhir/r4";
import type { AllergyReviewSource, AllergySource, AppointmentSource, DiagnosisSource, EncounterSource, FhirContext, VitalsSource } from "./sources";
import { codeSystem, compact, concept, externalMeta, ref, text } from "./support";
import { NO_KNOWN_ALLERGY, SYSTEMS, VITAL_SIGNS } from "./terminology";

const ENCOUNTER_STATUS = { in_progress: "in-progress", completed: "finished", entered_in_error: "entered-in-error" } as const;

export function toEncounter(ctx: FhirContext, patientId: string, e: EncounterSource, diagnoses: DiagnosisSource[]): Encounter {
  const virtual = e.modality === "telemedicine";
  return compact<Encounter>({
    resourceType: "Encounter",
    id: e.id,
    status: ENCOUNTER_STATUS[e.status],
    class: virtual ? { system: SYSTEMS.v3ActCode, code: "VR", display: "virtual" } : { system: SYSTEMS.v3ActCode, code: "AMB", display: "ambulatory" },
    type: e.visitTypeName ? [text(e.visitTypeName)] : undefined,
    subject: ref("Patient", patientId),
    participant: [{ individual: ref("Practitioner", e.practitionerId) }],
    appointment: e.appointmentId ? [ref("Appointment", e.appointmentId)] : undefined,
    period: compact({ start: e.startedAt, end: e.completedAt ?? undefined }),
    reasonCode: e.chiefComplaint ? [text(e.chiefComplaint)] : undefined,
    diagnosis: diagnoses
      .filter((d) => d.encounterId === e.id && d.status !== "entered_in_error")
      .map((d) => ({ condition: ref("Condition", d.id, d.display), rank: d.rank === "primary" ? 1 : 2 })),
    location: [{ location: ref("Location", e.facilityId) }],
    serviceProvider: ref("Organization", ctx.organization.id),
  });
}

export function toCondition(ctx: FhirContext, patientId: string, d: DiagnosisSource): Condition {
  const inError = d.status === "entered_in_error";
  return compact<Condition>({
    resourceType: "Condition",
    id: d.id,
    // con-5: no clinical status when the condition was entered in error.
    clinicalStatus: inError ? undefined : concept({ system: SYSTEMS.conditionClinical, code: d.status === "resolved" ? "resolved" : "active" }),
    verificationStatus: concept({ system: SYSTEMS.conditionVerification, code: inError ? "entered-in-error" : d.certainty }),
    category: [concept({ system: SYSTEMS.conditionCategory, code: "encounter-diagnosis", display: "Encounter Diagnosis" })],
    code:
      d.code && d.codeSystemKey
        ? {
            coding: [compact({ system: codeSystem(ctx, d.codeSystemKey), version: d.codeSystemVersion ?? undefined, code: d.code, display: d.display })],
            text: d.display,
          }
        : text(d.display),
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", d.encounterId),
    recordedDate: d.recordedAt,
  });
}

const ALLERGY_CLINICAL: Record<string, "active" | "inactive" | "resolved"> = { active: "active", inactive: "inactive", resolved: "resolved" };
const ALLERGY_CATEGORY: Record<string, "food" | "medication" | "environment" | "biologic"> = {
  food: "food",
  medication: "medication",
  environment: "environment",
  biologic: "biologic",
};

/**
 * An allergy. One accepted from an import (`source = external_import`) carries the external-source tag and is always
 * `unconfirmed`: nobody in this organization verified it.
 */
export function toAllergyIntolerance(ctx: FhirContext, patientId: string, a: AllergySource): AllergyIntolerance {
  const inError = a.status === "entered_in_error";
  const imported = a.source === "external_import";
  const category = ALLERGY_CATEGORY[a.category];
  return compact<AllergyIntolerance>({
    resourceType: "AllergyIntolerance",
    id: a.id,
    meta: imported ? externalMeta(ctx) : undefined,
    // ait-2: no clinical status when entered in error.
    clinicalStatus: inError ? undefined : concept({ system: SYSTEMS.allergyClinical, code: ALLERGY_CLINICAL[a.status] ?? "active" }),
    verificationStatus: concept({ system: SYSTEMS.allergyVerification, code: inError ? "entered-in-error" : imported ? "unconfirmed" : a.verification }),
    category: category ? [category] : undefined,
    criticality: a.criticality === "unable_to_assess" ? "unable-to-assess" : a.criticality,
    code: text(a.substance),
    patient: ref("Patient", patientId),
    recordedDate: a.recordedAt,
    reaction: a.reaction ? [compact({ manifestation: [text(a.reaction)], severity: a.severity ?? undefined })] : undefined,
  });
}

/** A recorded "no known allergies" review, stated the usual FHIR way (only when no allergy is active). */
export function toNoKnownAllergies(patientId: string, review: AllergyReviewSource): AllergyIntolerance {
  return {
    resourceType: "AllergyIntolerance",
    id: `nka-${patientId}`,
    clinicalStatus: concept({ system: SYSTEMS.allergyClinical, code: "active" }),
    verificationStatus: concept({ system: SYSTEMS.allergyVerification, code: "confirmed" }),
    code: concept(NO_KNOWN_ALLERGY, "No known allergies"),
    patient: ref("Patient", patientId),
    recordedDate: review.reviewedAt,
  };
}

type Vital = (typeof VITAL_SIGNS)[keyof Omit<typeof VITAL_SIGNS, "panel" | "bloodPressure">];

function quantity(v: Vital, value: number): Quantity {
  return { value, unit: v.human, system: SYSTEMS.ucum, code: v.unit };
}

/** Vital signs following the FHIR R4 vital signs profile: one Observation per measurement, blood pressure as components. */
export function toVitalSignObservations(patientId: string, v: VitalsSource): Observation[] {
  const base = (suffix: string, code: { code: string; display: string }): Observation =>
    compact<Observation>({
      resourceType: "Observation",
      id: `${v.id}-${suffix}`,
      status: v.status === "entered_in_error" ? "entered-in-error" : "final",
      category: [concept({ system: SYSTEMS.observationCategory, code: "vital-signs", display: "Vital Signs" })],
      code: concept({ system: SYSTEMS.loinc, code: code.code, display: code.display }, code.display),
      subject: ref("Patient", patientId),
      encounter: v.encounterId ? ref("Encounter", v.encounterId) : undefined,
      effectiveDateTime: v.measuredAt,
    });
  const out: Observation[] = [];
  if (v.systolicMmhg !== null || v.diastolicMmhg !== null) {
    const components: ObservationComponent[] = [];
    if (v.systolicMmhg !== null) {
      components.push({
        code: concept({ system: SYSTEMS.loinc, code: VITAL_SIGNS.systolic.code, display: VITAL_SIGNS.systolic.display }),
        valueQuantity: quantity(VITAL_SIGNS.systolic, v.systolicMmhg),
      });
    }
    if (v.diastolicMmhg !== null) {
      components.push({
        code: concept({ system: SYSTEMS.loinc, code: VITAL_SIGNS.diastolic.code, display: VITAL_SIGNS.diastolic.display }),
        valueQuantity: quantity(VITAL_SIGNS.diastolic, v.diastolicMmhg),
      });
    }
    out.push({ ...base("bp", VITAL_SIGNS.bloodPressure), component: components });
  }
  const single: Array<[string, Vital, number | null]> = [
    ["hr", VITAL_SIGNS.heartRate, v.heartRateBpm],
    ["rr", VITAL_SIGNS.respiratoryRate, v.respiratoryRateBpm],
    ["temp", VITAL_SIGNS.temperature, v.temperatureC],
    ["spo2", VITAL_SIGNS.oxygenSaturation, v.spo2Percent],
    ["wt", VITAL_SIGNS.weight, v.weightKg],
    ["ht", VITAL_SIGNS.height, v.heightCm],
  ];
  for (const [suffix, vital, value] of single) if (value !== null) out.push({ ...base(suffix, vital), valueQuantity: quantity(vital, value) });
  if (v.weightKg !== null && v.heightCm !== null && v.heightCm > 0) {
    const bmi = Math.round((v.weightKg / (v.heightCm / 100) ** 2) * 10) / 10;
    out.push({ ...base("bmi", VITAL_SIGNS.bmi), valueQuantity: quantity(VITAL_SIGNS.bmi, bmi) });
  }
  return out;
}

const APPOINTMENT_STATUS = {
  booked: "booked",
  confirmed: "booked",
  checked_in: "checked-in",
  completed: "fulfilled",
  cancelled: "cancelled",
  no_show: "noshow",
} as const;

export function toAppointment(patientId: string, a: AppointmentSource): Appointment {
  return compact<Appointment>({
    resourceType: "Appointment",
    id: a.id,
    status: APPOINTMENT_STATUS[a.status],
    cancelationReason: a.status === "cancelled" && a.cancellationReason ? text(a.cancellationReason) : undefined,
    serviceType: [text(a.visitTypeName)],
    appointmentType: a.modality === "telemedicine" ? text("Online consultation") : undefined,
    description: a.reason ?? undefined,
    start: a.startsAt,
    end: a.endsAt,
    participant: [
      { actor: ref("Patient", patientId), required: "required", status: "accepted" },
      { actor: ref("Practitioner", a.practitionerId, a.practitionerName), required: "required", status: "accepted" },
      { actor: ref("Location", a.facilityId), required: "required", status: "accepted" },
    ],
  });
}
