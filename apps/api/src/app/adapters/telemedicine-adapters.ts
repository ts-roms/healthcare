import { Injectable } from "@nestjs/common";
import { PrepaymentService } from "@healthcare/billing";
import { OnlineVisitService } from "@healthcare/clinic";
import type { Actor } from "@healthcare/core";
import { ConsentTextService, type ConsentTextView, PatientRecordService } from "@healthcare/patient";
import type { AcknowledgementWording, OnlineAppointment, TelemedicineClinic, TelemedicinePayments } from "@healthcare/telemedicine";

/** Telemedicine → clinic and patient: online appointments, the waiting-room check-in, the telemedicine encounter. */
@Injectable()
export class AppTelemedicineClinic implements TelemedicineClinic {
  constructor(
    private readonly online: OnlineVisitService,
    private readonly patients: PatientRecordService,
    private readonly consentTexts: ConsentTextService,
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

  async currentAcknowledgement(organizationId: string) {
    return toWording(await this.consentTexts.currentOffered(organizationId, "telemedicine"));
  }

  async acknowledgementById(organizationId: string, id: string) {
    return toWording(await this.consentTexts.byId(organizationId, id));
  }

  async patientDisplayName(organizationId: string, patientId: string) {
    return (await this.patients.briefs(organizationId, [patientId])).get(patientId)?.displayName;
  }
}

function toWording(view: ConsentTextView | null): AcknowledgementWording | null {
  if (!view?.title || !view.body || !view.acknowledgement) return null;
  return { id: view.id, version: view.version, title: view.title, body: view.body, statement: view.acknowledgement };
}

/** Telemedicine → billing: charging an online visit before the call, for organizations that require payment first. */
@Injectable()
export class AppTelemedicinePayments implements TelemedicinePayments {
  constructor(private readonly prepayments: PrepaymentService) {}

  ensure(request: Parameters<TelemedicinePayments["ensure"]>[0]) {
    return this.prepayments.ensure(request);
  }

  status(organizationId: string, appointmentId: string) {
    return this.prepayments.status(organizationId, appointmentId);
  }
}
