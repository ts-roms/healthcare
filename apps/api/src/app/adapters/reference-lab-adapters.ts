import { Injectable } from "@nestjs/common";
import { ClinicQueries } from "@healthcare/clinic";
import type { ReferenceLabDispatchSource, ReferenceLabSink, ReferenceLabSources } from "@healthcare/interoperability";
import { SendOutService } from "@healthcare/laboratory";
import { PatientRecordService } from "@healthcare/patient";

/** Reference laboratory interface → laboratory, patient and clinic: the dispatch's specimens, the patients' identity, requesting physicians. */
@Injectable()
export class AppReferenceLabSources implements ReferenceLabSources {
  constructor(
    private readonly sendOuts: SendOutService,
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
  ) {}

  async forDispatch(organizationId: string, dispatchId: string): Promise<(ReferenceLabDispatchSource & { patientIds: string[] }) | undefined> {
    const src = await this.sendOuts.dispatchSource(organizationId, dispatchId);
    if (!src) return undefined;
    // Only tests still travelling: cancelled, rejected and answered send-outs are not sent.
    const specimens = src.specimens.map((s) => ({ ...s, tests: s.tests.filter((t) => t.status === "dispatched") })).filter((s) => s.tests.length > 0);
    const patientIds = [...new Set(specimens.map((s) => s.patientId))];
    const [identities, physicians] = await Promise.all([
      Promise.all(patientIds.map(async (id) => [id, await this.patients.identity(organizationId, id, "philhealth_pin")] as const)),
      this.clinic.practitionerNames(organizationId, [...new Set(specimens.map((s) => s.orderingPractitionerId).filter((id): id is string => !!id))]),
    ]);
    const identity = new Map(identities);
    return {
      patientIds,
      dispatch: {
        id: src.dispatch.id,
        manifestNumber: src.dispatch.manifestNumber,
        dispatchedAt: src.dispatch.dispatchedAt.toISOString(),
        courier: src.dispatch.courier,
        courierReference: src.dispatch.courierReference,
      },
      sendingFacility: { id: src.facility.id, name: src.facility.name },
      referenceLaboratory: src.referenceLaboratory,
      specimens: specimens.map((s) => {
        const person = identity.get(s.patientId);
        return {
          accessionNumber: s.accessionNumber,
          specimenType: s.specimenType,
          container: s.container,
          collectedAt: s.collectedAt.toISOString(),
          orderNumber: s.orderNumber,
          priority: s.priority,
          fastingRequired: s.fastingRequired,
          clinicalIndication: s.clinicalIndication,
          requestingPhysician: s.orderingPractitionerId ? (physicians.get(s.orderingPractitionerId) ?? null) : s.externalOrderer,
          // The PhilHealth PIN is not part of a referral.
          patient: person
            ? {
                id: person.id,
                patientNumber: person.patientNumber,
                familyName: person.familyName,
                givenName: person.givenName,
                middleName: person.middleName,
                sex: person.sex,
                birthDate: person.birthDate,
              }
            : null,
          tests: s.tests.map((t) => ({ sendOutId: t.sendOutId, code: t.code, name: t.name, loincCode: t.loincCode })),
        };
      }),
    };
  }
}

/** Reference laboratory interface → laboratory: record an acknowledged electronic submission on the dispatch. */
@Injectable()
export class AppReferenceLabSink implements ReferenceLabSink {
  constructor(private readonly sendOuts: SendOutService) {}

  dispatchAcknowledged(input: { organizationId: string; dispatchId: string; reference: string; exchangeId: string }): Promise<void> {
    return this.sendOuts.recordElectronicAcknowledgement(input);
  }
}
