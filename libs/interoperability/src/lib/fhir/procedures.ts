import type { Coding, Procedure } from "fhir/r4";
import type { ClinicProcedureSource, FhirContext } from "./sources";
import { codeSystem, compact, concept, localSystem, ref, text } from "./support";

/**
 * A procedure performed at the clinic (not dental) → `Procedure`: completed or entered in error; category local
 * `…/codesystem/procedure-category#clinic-procedure`; the organization's own code under
 * `…/codesystem/clinic-procedure` (and the code of a system it names, when its catalogue gives one); the consultation
 * (none when performed under a queue visit without one), the performing practitioner and the facility; the body site as written; how many as a note. The clinician's notes
 * are not exported. Recorded rows change only when marked entered in error (database trigger), so `meta.lastUpdated`
 * is that time, else when it was recorded.
 */
export function toClinicProcedure(ctx: FhirContext, patientId: string, p: ClinicProcedureSource): Procedure {
  const codings: Coding[] = [{ system: localSystem(ctx, "codesystem/clinic-procedure"), code: p.code, display: p.name }];
  if (p.codeSystem && p.externalCode) codings.push({ system: codeSystem(ctx, p.codeSystem), code: p.externalCode });
  return compact<Procedure>({
    resourceType: "Procedure",
    id: p.id,
    meta: { lastUpdated: p.enteredInErrorAt ?? p.recordedAt },
    status: p.enteredInErrorAt ? "entered-in-error" : "completed",
    category: concept(
      { system: localSystem(ctx, "codesystem/procedure-category"), code: "clinic-procedure", display: "Procedure performed at the clinic" },
      "Procedure performed at the clinic",
    ),
    code: { coding: codings, text: p.name },
    subject: ref("Patient", patientId),
    encounter: p.encounterId ? ref("Encounter", p.encounterId) : undefined,
    performedDateTime: p.performedAt,
    performer: [{ actor: ref("Practitioner", p.performerPractitionerId) }],
    location: ref("Location", p.facilityId),
    bodySite: p.bodySite ? [text(p.bodySite)] : undefined,
    note: p.quantity > 1 ? [{ text: `Quantity: ${p.quantity}` }] : undefined,
  });
}
