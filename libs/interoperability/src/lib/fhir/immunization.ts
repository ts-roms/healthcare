import type { CodeableConcept, Immunization } from "fhir/r4";
import type { FhirContext, ImmunizationSource } from "./sources";
import { codeSystem, compact, concept, externalMeta, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

/**
 * Immunization records as FHIR R4 `Immunization`. The vaccine is the organization's own catalogue entry (its code under
 * the configured or local code system for the catalogue's key) or, for an accepted import, as the sender named and
 * coded it. No official vaccine code set (e.g. CVX) is assumed: an organization that is licensed to use one names it as
 * a code-system key and configures its URI (`FHIR_CODE_SYSTEMS`). A partial date is exported at its precision
 * (`occurrenceDateTime` allows a year or a year and month). Doses reported by the patient or another provider are
 * `primarySource: false` with where the information came from as `reportOrigin` text; imported ones carry the
 * external-source tag. Staff notes are not exported.
 */

/** HL7 v3 ActReason codes of the R4 example value set for Immunization.statusReason. */
const NOT_DONE_REASON: Record<string, { code: string; display: string } | undefined> = {
  refused: { code: "PATOBJ", display: "patient objection" },
  contraindicated: { code: "MEDPREC", display: "medical precaution" },
  unavailable: { code: "OSTOCK", display: "product out of stock" },
};
const NOT_DONE_TEXT: Record<string, string> = {
  refused: "Refused",
  contraindicated: "Contraindicated",
  unavailable: "Vaccine unavailable",
  other: "Other reason",
};

const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

function vaccineCode(ctx: FhirContext, i: ImmunizationSource): CodeableConcept {
  if (!i.vaccineCode) return text(i.vaccineName);
  const system =
    i.source === "external_import"
      ? i.vaccineCodeSystem && ABSOLUTE_URI.test(i.vaccineCodeSystem)
        ? i.vaccineCodeSystem
        : undefined
      : codeSystem(ctx, i.vaccineCodeSystem ?? "vaccine");
  return { coding: [compact({ system, code: i.vaccineCode, display: i.vaccineName })], text: i.vaccineName };
}

/** The occurrence at its precision, as an R4 dateTime (YYYY, YYYY-MM, YYYY-MM-DD or an instant). */
export function occurrenceDateTime(i: Pick<ImmunizationSource, "occurrenceDate" | "occurrencePrecision" | "occurredAt">): string {
  switch (i.occurrencePrecision) {
    case "year":
      return i.occurrenceDate.slice(0, 4);
    case "month":
      return i.occurrenceDate.slice(0, 7);
    case "time":
      return i.occurredAt ?? i.occurrenceDate;
    default:
      return i.occurrenceDate;
  }
}

function latest(...instants: Array<string | null>): string {
  return instants.filter((t): t is string => Boolean(t)).sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
}

export function toImmunization(ctx: FhirContext, patientId: string, i: ImmunizationSource): Immunization {
  const inError = i.enteredInErrorAt !== null;
  const notDone = i.status === "not_done";
  // Reliable: a record changes only when marked entered in error or when a reaction is added (database trigger).
  const lastUpdated = latest(i.recordedAt, i.adverseReactionRecordedAt, i.enteredInErrorAt);
  const reason = notDone && i.notDoneReason ? NOT_DONE_REASON[i.notDoneReason] : undefined;
  const reasonText = notDone ? (i.notDoneReasonText ?? (i.notDoneReason ? NOT_DONE_TEXT[i.notDoneReason] : undefined)) : undefined;
  const dose = i.doseLabel ?? (i.doseNumber !== null ? String(i.doseNumber) : null);
  return compact<Immunization>({
    resourceType: "Immunization",
    id: i.id,
    meta: i.source === "external_import" ? externalMeta(ctx, { lastUpdated, declaredSource: i.declaredSource }) : { lastUpdated },
    status: inError ? "entered-in-error" : notDone ? "not-done" : "completed",
    statusReason: notDone
      ? reason
        ? concept({ system: SYSTEMS.v3ActReason, code: reason.code, display: reason.display }, reasonText)
        : text(reasonText ?? "Not done")
      : undefined,
    vaccineCode: vaccineCode(ctx, i),
    patient: ref("Patient", patientId),
    encounter: i.encounterId ? ref("Encounter", i.encounterId) : undefined,
    occurrenceDateTime: occurrenceDateTime(i),
    recorded: i.recordedAt,
    primarySource: i.source === "administered_here",
    reportOrigin:
      i.source === "administered_here"
        ? undefined
        : text(i.sourceDescription ?? (i.source === "external_import" ? "Imported from another system" : "Reported")),
    location: i.facilityId ? ref("Location", i.facilityId) : undefined,
    manufacturer: i.vaccineManufacturer ? { display: i.vaccineManufacturer } : undefined,
    lotNumber: i.lotNumber ?? undefined,
    expirationDate: i.expiryDate ?? undefined,
    site: i.site ? text(i.site) : undefined,
    route: i.route ? text(i.route) : undefined,
    doseQuantity: i.doseQuantity !== null && i.doseUnit ? { value: i.doseQuantity, unit: i.doseUnit } : undefined,
    performer: i.performerPractitionerId
      ? [{ actor: ref("Practitioner", i.performerPractitionerId) }]
      : i.performerName
        ? [{ actor: { display: i.performerName } }]
        : undefined,
    reaction: i.adverseReaction && i.adverseReactionRecordedAt ? [{ date: i.adverseReactionRecordedAt, detail: { display: i.adverseReaction } }] : undefined,
    protocolApplied: dose ? [{ doseNumberString: dose }] : undefined,
  });
}
