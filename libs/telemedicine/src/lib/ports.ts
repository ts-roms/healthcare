import type { Actor } from "@healthcare/core";

export interface OnlineAppointment {
  id: string;
  patientId: string;
  facilityId: string;
  practitionerId: string;
  practitionerName: string;
  practitionerUserId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  reason: string | null;
  modality: "in_person" | "telemedicine";
  visitTypeName: string;
}

export interface TelemedicinePatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/**
 * What telemedicine needs from the clinic (appointments, the waiting-room
 * check-in, the telemedicine encounter) and the patient directory, implemented
 * by the app's composition root. Telemedicine never touches clinic tables.
 */
export interface TelemedicineClinic {
  appointment(organizationId: string, appointmentId: string): Promise<OnlineAppointment | undefined>;
  day(
    organizationId: string,
    facilityId: string,
    date: string,
  ): Promise<
    Array<OnlineAppointment & { visitId: string | null; visitStatus: string | null; encounterId: string | null; patient: TelemedicinePatientBrief | null }>
  >;
  patientOnline(organizationId: string, patientId: string): Promise<OnlineAppointment[]>;
  /** The patient enters the waiting room: checks the appointment in (idempotent). */
  checkIn(organizationId: string, appointmentId: string): Promise<{ id: string }>;
  /** Starts the telemedicine encounter for the visit as the clinician. */
  startEncounter(actor: Actor, visitId: string): Promise<{ id: string }>;
  encounterForVisit(organizationId: string, visitId: string): Promise<{ id: string } | undefined>;
  patientDisplayName(organizationId: string, patientId: string): Promise<string | undefined>;
}

export const TELEMEDICINE_CLINIC = Symbol("TELEMEDICINE_CLINIC");
