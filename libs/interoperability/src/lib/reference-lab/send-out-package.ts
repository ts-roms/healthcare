/**
 * The platform's own, format-neutral description of one dispatch of specimens to a reference laboratory. No reference
 * laboratory interface (HL7 v2 ORM/OML, ASTM, a vendor API) is on record: an adapter maps this package to whatever
 * the receiving laboratory specifies. Nothing here encodes a message format, code system or segment layout.
 */

/** What the platform gathers for one dispatch (the laboratory's send-outs and the patients' identity), filled by the API. */
export interface ReferenceLabDispatchSource {
  dispatch: {
    id: string;
    manifestNumber: string;
    dispatchedAt: string;
    courier: string;
    courierReference: string | null;
  };
  sendingFacility: { id: string; name: string };
  referenceLaboratory: { id: string; code: string; name: string; accreditationReference: string | null };
  specimens: Array<{
    accessionNumber: string;
    specimenType: string;
    container: string | null;
    collectedAt: string;
    orderNumber: string;
    priority: string;
    fastingRequired: boolean;
    clinicalIndication: string | null;
    requestingPhysician: string | null;
    patient: {
      id: string;
      patientNumber: string;
      familyName: string;
      givenName: string;
      middleName: string | null;
      sex: string;
      birthDate: string;
    } | null;
    /** Tests still travelling in this dispatch (cancelled and answered ones are left out by the caller). */
    tests: Array<{ sendOutId: string; code: string; name: string; loincCode: string | null }>;
  }>;
}

export interface ReferenceLabSendOutPackage {
  /** Identifies this package for the adapter and the receiving laboratory: the manifest number. */
  manifestNumber: string;
  dispatchedAt: string;
  courier: { name: string; reference: string | null };
  sendingFacility: { id: string; name: string };
  referenceLaboratory: { code: string; name: string };
  specimens: Array<{
    accessionNumber: string;
    specimenType: string;
    container: string | null;
    collectedAt: string;
    orderNumber: string;
    priority: string;
    fastingRequired: boolean;
    clinicalIndication: string | null;
    requestingPhysician: string | null;
    patient: {
      patientNumber: string;
      familyName: string;
      givenName: string;
      middleName: string | null;
      sex: string;
      birthDate: string;
    };
    tests: Array<{ sendOutId: string; code: string; name: string; loincCode: string | null }>;
  }>;
}

export interface SendOutReadinessCheck {
  key: string;
  ok: boolean;
  message: string;
}

/** Checks of the platform's own data only (what a package needs); never a rule of the receiving laboratory. */
export function sendOutReadiness(src: ReferenceLabDispatchSource): SendOutReadinessCheck[] {
  const travelling = src.specimens.filter((s) => s.tests.length > 0);
  return [
    { key: "specimens", ok: travelling.length > 0, message: travelling.length ? `${travelling.length} specimen(s) in the dispatch` : "Nothing left to send" },
    {
      key: "patients",
      ok: travelling.every((s) => s.patient !== null),
      message: travelling.every((s) => s.patient !== null) ? "Every specimen identifies its patient" : "A patient record could not be read",
    },
  ];
}

export function sendOutIsReady(checks: SendOutReadinessCheck[]): boolean {
  return checks.every((c) => c.ok);
}

/** The package for a ready source (see sendOutReadiness). */
export function buildSendOutPackage(src: ReferenceLabDispatchSource): ReferenceLabSendOutPackage {
  return {
    manifestNumber: src.dispatch.manifestNumber,
    dispatchedAt: src.dispatch.dispatchedAt,
    courier: { name: src.dispatch.courier, reference: src.dispatch.courierReference },
    sendingFacility: src.sendingFacility,
    referenceLaboratory: { code: src.referenceLaboratory.code, name: src.referenceLaboratory.name },
    specimens: src.specimens.flatMap((s) => {
      if (s.tests.length === 0 || !s.patient) return [];
      const { id: _id, ...patient } = s.patient;
      return [
        {
          accessionNumber: s.accessionNumber,
          specimenType: s.specimenType,
          container: s.container,
          collectedAt: s.collectedAt,
          orderNumber: s.orderNumber,
          priority: s.priority,
          fastingRequired: s.fastingRequired,
          clinicalIndication: s.clinicalIndication,
          requestingPhysician: s.requestingPhysician,
          patient,
          tests: s.tests,
        },
      ];
    }),
  };
}
