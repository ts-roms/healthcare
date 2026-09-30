import type { Organization, Practitioner, Reference, ServiceRequest } from "fhir/r4";
import type { FhirContext, ReferralSource } from "./sources";
import { compact, concept, identifier, localSystem, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

/** SNOMED CT 3457005 "Patient referral" — the category R4 uses for a referral ServiceRequest. */
export const REFERRAL_CATEGORY = { system: SYSTEMS.snomed, code: "3457005", display: "Patient referral" } as const;

const STATUS: Record<ReferralSource["status"], ServiceRequest["status"]> = {
  sent: "active",
  accepted: "active",
  // Carried out: the receiving practitioner's outcome, or the outside provider's reply, is on record.
  completed: "completed",
  // Ended before it was carried out: declined by the practitioner referred to, or cancelled by the referrer.
  declined: "revoked",
  cancelled: "revoked",
};

/**
 * The referrer's urgency as R4 `priority`: routine and urgent map one to one; emergency maps to `stat` ("with the
 * highest priority", above `asap`), because an emergency referral asks the recipient to act immediately. The
 * referrer's own word is kept in a note.
 */
export const REFERRAL_PRIORITY: Record<ReferralSource["urgency"], NonNullable<ServiceRequest["priority"]>> = {
  routine: "routine",
  urgent: "urgent",
  emergency: "stat",
};

/** The platform's own statuses and urgency, carried as notes alongside FHIR's coarser codes. */
const STATUS_TEXT: Record<ReferralSource["status"], string> = {
  sent: "Sent, awaiting the recipient",
  accepted: "Accepted by the practitioner referred to",
  declined: "Declined by the practitioner referred to",
  completed: "Completed",
  cancelled: "Cancelled by the referrer",
};

const EXTERNAL_ORGANIZATION = "referral-recipient-organization";
const EXTERNAL_PRACTITIONER = "referral-recipient";

/**
 * A referral as a ServiceRequest (category Patient referral, intent order): the referring consultation and
 * practitioner, the urgency as `priority` (REFERRAL_PRIORITY), the reason in the referrer's words, the diagnoses they
 * listed as `reasonReference` (Conditions), and the letter and the outside provider's reply as `supportingInfo` when
 * those documents are exported too (never a dangling reference). An internal referral's performer is the practitioner
 * referred to; an outside provider travels as contained resources exactly as the referrer wrote it (not verified): an
 * Organization for the facility (or the provider when no facility is named) and, when both are named, a Practitioner
 * for the provider.
 */
export function toReferralServiceRequest(
  ctx: FhirContext,
  patientId: string,
  r: ReferralSource,
  exportedDocuments: ReadonlySet<string> | null,
): ServiceRequest {
  const contained: Array<Organization | Practitioner> = [];
  let performer: Reference[] = [];
  if (r.kind === "internal" && r.toPractitionerId) {
    performer = [ref("Practitioner", r.toPractitionerId)];
  } else if (r.kind === "external" && r.externalProvider) {
    const facilityName = r.externalFacility ?? r.externalProvider;
    contained.push(
      compact<Organization>({
        resourceType: "Organization",
        id: EXTERNAL_ORGANIZATION,
        name: facilityName,
        telecom: r.externalContact ? [{ system: "other", value: r.externalContact }] : undefined,
      }),
    );
    if (r.externalFacility) {
      contained.push({ resourceType: "Practitioner", id: EXTERNAL_PRACTITIONER, name: [{ text: r.externalProvider }] });
      performer.push({ reference: `#${EXTERNAL_PRACTITIONER}`, display: r.externalProvider });
    }
    performer.push({ reference: `#${EXTERNAL_ORGANIZATION}`, display: facilityName });
  }
  const documents = exportedDocuments ? [r.id, ...(r.replyDocumentId ? [r.replyDocumentId] : [])].filter((id) => exportedDocuments.has(id)) : [];
  return compact<ServiceRequest>({
    resourceType: "ServiceRequest",
    id: r.id,
    contained: contained.length ? contained : undefined,
    identifier: [identifier(localSystem(ctx, "referral-number"), r.referralNumber)],
    status: STATUS[r.status],
    intent: "order",
    category: [concept(REFERRAL_CATEGORY, "Referral")],
    priority: REFERRAL_PRIORITY[r.urgency],
    code: text(r.specialty ?? "Referral"),
    subject: ref("Patient", patientId),
    encounter: ref("Encounter", r.encounterId),
    authoredOn: r.issuedAt,
    requester: ref("Practitioner", r.referringPractitionerId),
    performerType: r.specialty ? text(r.specialty) : undefined,
    performer: performer.length ? performer : undefined,
    reasonCode: [text(r.reason)],
    reasonReference: r.diagnosisIds.length ? r.diagnosisIds.map((id) => ref("Condition", id)) : undefined,
    supportingInfo: documents.length ? documents.map((id) => ref("DocumentReference", id)) : undefined,
    note: [
      ...(r.clinicalSummary ? [{ text: r.clinicalSummary }] : []),
      { text: `Urgency as written by the referrer: ${r.urgency}` },
      { text: `Referral status: ${STATUS_TEXT[r.status]}` },
    ],
  });
}
