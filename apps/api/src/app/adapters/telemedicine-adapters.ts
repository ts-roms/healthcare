import { Injectable } from "@nestjs/common";
import { OnlineVisitService } from "@healthcare/clinic";
import type { Actor } from "@healthcare/core";
import { PatientRecordService } from "@healthcare/patient";
import type { OnlineAppointment, TelemedicineClinic } from "@healthcare/telemedicine";

/** Telemedicine → clinic and patient: online appointments, the waiting-room check-in, the telemedicine encounter. */
@Injectable()
export class AppTelemedicineClinic implements TelemedicineClinic {
  constructor(
    private readonly online: OnlineVisitService,
    private readonly patients: PatientRecordService,
  ) {}

  appointment(organizationId: string, appointmentId: string): Promise<OnlineAppointment | undefined> {
    return this.online.appointment(organizationId, appointmentId);
  }

  day(organizationId: string, facilityId: string, date: string) {
    return this.online.day(organizationId, facilityId, date);
  }

  patientOnline(organizationId: string, patientId: string) {
    return this.online.patientOnline(organizationId, patientId);
  }

  async checkIn(organizationId: string, appointmentId: string) {
    const visit = await this.online.checkIn(organizationId, appointmentId);
    return { id: visit.id };
  }

  async startEncounter(actor: Actor, visitId: string) {
    const encounter = await this.online.startEncounter(actor, visitId);
    return { id: encounter.id };
  }

  encounterForVisit(organizationId: string, visitId: string) {
    return this.online.encounterForVisit(organizationId, visitId);
  }

  async patientDisplayName(organizationId: string, patientId: string) {
    return (await this.patients.briefs(organizationId, [patientId])).get(patientId)?.displayName;
  }
}
