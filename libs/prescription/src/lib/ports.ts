/**
 * What prescribing needs from the clinic domain, implemented by the app's
 * composition root (the prescription library must not import clinic).
 */
export interface PrescribingContext {
  /** The active practitioner linked to a staff account. */
  prescriber(organizationId: string, userId: string): Promise<{ id: string; profession: string; displayName: string } | undefined>;
  encounter(
    organizationId: string,
    encounterId: string,
  ): Promise<
    { id: string; patientId: string; facilityId: string; status: "in_progress" | "completed" | "entered_in_error"; practitionerId: string } | undefined
  >;
  /** Active allergies and whether the allergy history has been reviewed. */
  allergies(organizationId: string, patientId: string): Promise<AllergyContext>;
}

export interface AllergyContext {
  status: "has_allergies" | "no_known_allergies" | "not_reviewed";
  allergies: Array<{ id: string; substance: string; category: string; criticality: string; reaction: string | null }>;
}

export const PRESCRIBING_CONTEXT = Symbol("PRESCRIBING_CONTEXT");
