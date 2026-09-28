import { Injectable } from "@nestjs/common";
import type { BillableDentalProcedure, BillableEncounter, BillableLabOrder, BillingSources } from "@healthcare/billing";
import { ClinicQueries } from "@healthcare/clinic";
import { DentalProcedureService } from "@healthcare/dental";
import { LabOrderService } from "@healthcare/laboratory";

/**
 * Billing → clinic, laboratory and dentistry: what was done, for charge
 * capture. Only signed encounters are billable; cancelled laboratory items and
 * dental procedures entered in error are left out.
 */
@Injectable()
export class AppBillingSources implements BillingSources {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly lab: LabOrderService,
    private readonly dental: DentalProcedureService,
  ) {}

  async encounter(organizationId: string, encounterId: string): Promise<BillableEncounter | undefined> {
    const row = await this.clinic.billableEncounter(organizationId, encounterId);
    if (!row || row.status !== "completed") return undefined;
    return { id: row.id, patientId: row.patientId, facilityId: row.facilityId, visitTypeCode: row.visitTypeCode, serviceDate: row.serviceDate };
  }

  labOrder(organizationId: string, orderId: string): Promise<BillableLabOrder | undefined> {
    return this.lab.billableOrder(organizationId, orderId);
  }

  dentalProcedure(organizationId: string, procedureId: string): Promise<BillableDentalProcedure | undefined> {
    return this.dental.billable(organizationId, procedureId);
  }
}
