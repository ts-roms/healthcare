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
  /** The visit type's code, which billing maps to a service (for prepaid online visits). */
  visitTypeCode: string;
  /** The facility's time zone, for showing the patient the consultation's times. */
  timeZone: string;
}

export interface TelemedicinePatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/** The organization's own wording of the online-consultation acknowledgement (a `telemedicine` consent wording), as one version. */
export interface AcknowledgementWording {
  id: string;
  version: number;
  title: string;
  body: string;
  /** The statement the patient confirms. */
  statement: string;
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
  /** The organization's acknowledgement wording as offered now; null = none written (the platform's plain statement is shown). */
  currentAcknowledgement(organizationId: string): Promise<AcknowledgementWording | null>;
  /** One version of that wording by id (what a patient saw). */
  acknowledgementById(organizationId: string, id: string): Promise<AcknowledgementWording | null>;
}

export const TELEMEDICINE_CLINIC = Symbol("TELEMEDICINE_CLINIC");

/** Where payment for an online visit stands (billing's PrepaymentService, through the app's adapter). */
export interface PrepaymentView {
  /** `not_required`: nothing is charged for this visit (no service mapped to the visit type, or no price). */
  state: "not_required" | "unpaid" | "paid";
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** In centavos. */
  amount: number;
  balance: number;
}

/**
 * What telemedicine needs from billing when an organization requires payment before the waiting room: charge and invoice the
 * visit once, and say whether it is paid. Telemedicine never touches billing tables.
 */
export interface TelemedicinePayments {
  ensure(request: {
    organizationId: string;
    facilityId: string;
    patientId: string;
    appointmentId: string;
    visitTypeCode: string;
    serviceDate: string;
  }): Promise<PrepaymentView>;
  status(organizationId: string, appointmentId: string): Promise<PrepaymentView>;
}

export const TELEMEDICINE_PAYMENTS = Symbol("TELEMEDICINE_PAYMENTS");
