import { Injectable } from "@nestjs/common";
import { ClinicQueries, VisitService, type VisitView } from "@healthcare/clinic";
import { type Actor, BusinessRuleError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import type { z } from "zod";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskSessionService } from "./kiosk-session.service";
import type { kioskCheckInSchema } from "./kiosk.dto";

export interface KioskTicket {
  /** "A-007": the same label the queue board and the waiting-room display use. */
  ticket: string;
  queueNumber: number;
  facilityName: string;
  issuedAt: Date;
  /** Always a plain instruction; nothing about the patient. */
  instructions: string;
}

/**
 * Check-in at a kiosk (docs/domains/kiosk.md). Both ways go through the clinic's own visit code — the same ticket
 * counter and the same "one active visit per patient" rule — for the patient the session identified. The screen never
 * names the patient: `patientId` comes from the session.
 */
@Injectable()
export class KioskCheckInService {
  constructor(
    private readonly devices: KioskDeviceService,
    private readonly sessions: KioskSessionService,
    private readonly visits: VisitService,
    private readonly clinic: ClinicQueries,
    private readonly organizations: OrganizationService,
  ) {}

  /** The services a walk-in can choose at this kiosk (the organization switches visit types on for kiosks). */
  async services(actor: Actor): Promise<Array<{ id: string; name: string }>> {
    await this.devices.requireDevice(actor, { serving: true });
    return this.clinic.kioskVisitTypes(actor.organizationId);
  }

  /** Today's appointments of the identified patient at this facility, with whether check-in is open. */
  async appointments(actor: Actor, token: string | undefined) {
    const session = await this.sessions.resolve(actor, token, { identified: true });
    const items = await this.clinic.kioskAppointments(actor.organizationId, session.facilityId, session.patientId!);
    return { items };
  }

  async checkIn(actor: Actor, token: string | undefined, input: z.infer<typeof kioskCheckInSchema>): Promise<KioskTicket> {
    const session = await this.sessions.resolve(actor, token, { identified: true });
    const patientId = session.patientId!;
    let visit: VisitView;
    if (input.appointmentId) visit = await this.visits.kioskCheckInAppointment(actor, patientId, input.appointmentId);
    else if (input.visitTypeId) visit = await this.visits.kioskWalkIn(actor, { patientId, visitTypeId: input.visitTypeId });
    else throw new BusinessRuleError("Choose an appointment or a service", "kiosk_choice_required");
    const facility = await this.organizations.getFacility(actor.organizationId, visit.facilityId);
    return {
      ticket: visit.ticket,
      queueNumber: visit.queueNumber,
      facilityName: facility.name,
      issuedAt: visit.checkedInAt,
      instructions: "Please take a seat. Your number will be shown on the screen when it is your turn.",
    };
  }
}
