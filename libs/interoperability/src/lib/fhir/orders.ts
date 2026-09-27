import type { CarePlan, CarePlanActivity, CodeableConcept, DiagnosticReport, Dosage, MedicationRequest, Observation, ServiceRequest } from "fhir/r4";
import type { CarePlanSource, FhirContext, LabItemSource, LabOrderSource, LabResultSource, PrescriptionSource } from "./sources";
import { compact, concept, identifier, localSystem, ref, text } from "./support";
import { LAB_REPORT_CODE, SYSTEMS } from "./terminology";

function testCode(ctx: FhirContext, item: LabItemSource): CodeableConcept {
  return {
    coding: [
      ...(item.loincCode ? [{ system: SYSTEMS.loinc, code: item.loincCode, display: item.testName }] : []),
      { system: localSystem(ctx, "codesystem/lab-test"), code: item.testCode, display: item.testName },
    ],
    text: item.testName,
  };
}

const LAB_CATEGORY = concept({ system: SYSTEMS.observationCategory, code: "laboratory", display: "Laboratory" });

/** Each ordered test as a ServiceRequest; the order number groups them (requisition). */
export function toServiceRequests(ctx: FhirContext, patientId: string, order: LabOrderSource): ServiceRequest[] {
  return order.items.map((item) =>
    compact<ServiceRequest>({
      resourceType: "ServiceRequest",
      id: item.id,
      requisition: identifier(localSystem(ctx, "lab-order-number"), order.orderNumber),
      status: order.status === "cancelled" || item.status === "cancelled" ? "revoked" : item.result || order.status === "completed" ? "completed" : "active",
      intent: "order",
      category: [text("Laboratory")],
      priority: order.priority === "stat" ? "stat" : "routine",
      code: testCode(ctx, item),
      subject: ref("Patient", patientId),
      encounter: order.encounterId ? ref("Encounter", order.encounterId) : undefined,
      authoredOn: order.orderedAt,
      requester: order.orderingPractitionerId ? ref("Practitioner", order.orderingPractitionerId) : undefined,
      reasonCode: order.clinicalIndication ? [text(order.clinicalIndication)] : undefined,
      performer: [ref("Organization", ctx.organization.id)],
    }),
  );
}

const INTERPRETATION: Record<NonNullable<LabResultSource["flag"]>, { code: string; display: string }> = {
  normal: { code: "N", display: "Normal" },
  low: { code: "L", display: "Low" },
  high: { code: "H", display: "High" },
  critical_low: { code: "LL", display: "Critical low" },
  critical_high: { code: "HH", display: "Critical high" },
  abnormal: { code: "A", display: "Abnormal" },
};

/** A released laboratory result as an Observation (a corrected version is "corrected"). */
export function toLabObservation(ctx: FhirContext, patientId: string, order: LabOrderSource, item: LabItemSource, r: LabResultSource): Observation {
  const unit = r.unit ?? undefined;
  return compact<Observation>({
    resourceType: "Observation",
    id: r.id,
    basedOn: [ref("ServiceRequest", item.id)],
    status: r.versionNumber > 1 ? "corrected" : "final",
    category: [LAB_CATEGORY],
    code: testCode(ctx, item),
    subject: ref("Patient", patientId),
    encounter: order.encounterId ? ref("Encounter", order.encounterId) : undefined,
    effectiveDateTime: r.collectedAt ?? undefined,
    issued: r.releasedAt ?? undefined,
    performer: [ref("Organization", ctx.organization.id)],
    valueQuantity: r.resultType === "numeric" && r.valueNumeric !== null ? compact({ value: r.valueNumeric, unit }) : undefined,
    valueString: r.resultType === "text" && r.valueText ? r.valueText : undefined,
    valueCodeableConcept: r.resultType === "coded" && r.valueCoded ? text(r.valueCoded) : undefined,
    interpretation: r.flag ? [concept({ system: SYSTEMS.v3Interpretation, ...INTERPRETATION[r.flag] })] : undefined,
    note: r.comment ? [{ text: r.comment }] : undefined,
    referenceRange:
      r.refLow !== null || r.refHigh !== null || r.refText
        ? [
            compact({
              low: r.refLow !== null ? compact({ value: r.refLow, unit }) : undefined,
              high: r.refHigh !== null ? compact({ value: r.refHigh, unit }) : undefined,
              text: r.refText ?? undefined,
            }),
          ]
        : undefined,
  });
}

/** The released results of an order as a DiagnosticReport ("partial" while some tests are still pending). */
export function toDiagnosticReport(ctx: FhirContext, patientId: string, order: LabOrderSource): DiagnosticReport | null {
  const released = order.items.filter((i) => i.result);
  if (released.length === 0) return null;
  const pending = order.items.some((i) => !i.result && i.status !== "cancelled") && order.status !== "cancelled";
  const collected = released
    .map((i) => i.result?.collectedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  const issued = released
    .map((i) => i.result?.releasedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  return compact<DiagnosticReport>({
    resourceType: "DiagnosticReport",
    id: order.id,
    identifier: [identifier(localSystem(ctx, "lab-order-number"), order.orderNumber)],
    basedOn: order.items.map((i) => ref("ServiceRequest", i.id)),
    status: pending ? "partial" : released.some((i) => (i.result?.versionNumber ?? 1) > 1) ? "corrected" : "final",
    category: [concept({ system: SYSTEMS.v2DiagnosticService, code: "LAB", display: "Laboratory" })],
    code: concept(LAB_REPORT_CODE, "Laboratory report"),
    subject: ref("Patient", patientId),
    encounter: order.encounterId ? ref("Encounter", order.encounterId) : undefined,
    effectiveDateTime: collected[0],
    issued: issued[issued.length - 1],
    performer: [ref("Organization", ctx.organization.id)],
    result: released.map((i) => ref("Observation", i.result?.id ?? "", i.testName)),
  });
}

const PRESCRIPTION_STATUS = { active: "active", cancelled: "cancelled", superseded: "stopped", replaced: "stopped" } as const;

/** Each prescription line as a MedicationRequest; the prescription number groups them. */
export function toMedicationRequests(ctx: FhirContext, patientId: string, p: PrescriptionSource): MedicationRequest[] {
  return p.items.map((item) => {
    const medication = [item.genericName, item.strength, item.dosageForm].filter(Boolean).join(" ");
    const dosage = compact<Dosage>({
      sequence: 1,
      text: [
        item.doseAmount !== null ? `${item.doseAmount} ${item.doseUnit ?? ""}`.trim() : null,
        item.route,
        item.frequencyText ?? item.frequency?.replace(/_/g, " "),
        item.durationValue !== null ? `for ${item.durationValue} ${item.durationUnit ?? ""}`.trim() : null,
        item.asNeeded ? `as needed${item.asNeededReason ? ` for ${item.asNeededReason}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(", "),
      patientInstruction: item.instructions ?? undefined,
      timing:
        item.frequency || item.durationValue !== null
          ? compact({
              code: item.frequency ? text(item.frequencyText ?? item.frequency.replace(/_/g, " ")) : undefined,
              repeat:
                item.durationValue !== null ? { boundsDuration: compact({ value: item.durationValue, unit: item.durationUnit ?? undefined }) } : undefined,
            })
          : undefined,
      asNeededBoolean: item.asNeeded && !item.asNeededReason ? true : undefined,
      asNeededCodeableConcept: item.asNeeded && item.asNeededReason ? text(item.asNeededReason) : undefined,
      route: item.route ? text(item.route) : undefined,
      doseAndRate: item.doseAmount !== null ? [{ doseQuantity: compact({ value: item.doseAmount, unit: item.doseUnit ?? undefined }) }] : undefined,
    });
    return compact<MedicationRequest>({
      resourceType: "MedicationRequest",
      id: `${p.id}-${item.lineNumber}`,
      // Reliable: a prescription is immutable once issued (database triggers); cancel/replace is its only change.
      meta: { lastUpdated: p.cancelledAt ?? p.issuedAt },
      groupIdentifier: identifier(localSystem(ctx, "prescription-number"), p.prescriptionNumber),
      status: PRESCRIPTION_STATUS[p.status as keyof typeof PRESCRIPTION_STATUS] ?? "unknown",
      intent: "order",
      medicationCodeableConcept: text(item.brandName ? `${medication} (${item.brandName})` : medication),
      subject: ref("Patient", patientId),
      encounter: p.encounterId ? ref("Encounter", p.encounterId) : undefined,
      authoredOn: p.issuedAt,
      requester: ref("Practitioner", p.prescriberPractitionerId),
      dosageInstruction: [dosage],
      dispenseRequest:
        item.quantity !== null
          ? compact({ quantity: compact({ value: item.quantity, unit: item.quantityUnit ?? undefined }), numberOfRepeatsAllowed: item.refills })
          : undefined,
    });
  });
}

const PLAN_STATUS = { draft: "draft", active: "active", on_hold: "on-hold", completed: "completed", cancelled: "revoked" } as const;
const ACTIVITY_STATUS = { planned: "not-started", scheduled: "scheduled", in_progress: "in-progress", completed: "completed", cancelled: "cancelled" } as const;

export function toCarePlan(patientId: string, c: CarePlanSource): CarePlan {
  return compact<CarePlan>({
    resourceType: "CarePlan",
    id: c.id,
    status: PLAN_STATUS[c.status],
    intent: "plan",
    category: [text(c.category.replace(/_/g, " "))],
    title: c.title,
    description: c.description ?? undefined,
    subject: ref("Patient", patientId),
    period: compact({ start: c.startDate, end: c.endDate ?? undefined }),
    created: c.createdAt,
    author: c.authorPractitionerId ? ref("Practitioner", c.authorPractitionerId) : undefined,
    activity: c.activities.map((a): CarePlanActivity => ({
      detail: compact({
        code: text(a.kind.replace(/_/g, " ")),
        status: ACTIVITY_STATUS[a.status],
        description: a.description,
        scheduledString: a.dueDate ? `Due ${a.dueDate}` : undefined,
      }),
    })),
  });
}
