import { Injectable } from "@nestjs/common";
import type { BillableEncounter, BillableLabOrder, BillingSources } from "@healthcare/billing";
import { ClinicQueries } from "@healthcare/clinic";
import { LabOrderService } from "@healthcare/laboratory";

/**
 * Billing → clinic and laboratory: what was done, for charge capture. Only
 * signed encounters are billable; cancelled laboratory items are left out.
 */
@Injectable()
export class AppBillingSources implements BillingSources {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly lab: LabOrderService,
  ) {}

  async encounter(organizationId: string, encounterId: string): Promise<BillableEncounter | undefined> {
    const row = await this.clinic.billableEncounter(organizationId, encounterId);
    if (!row || row.status !== "completed") return undefined;
    return { id: row.id, patientId: row.patientId, facilityId: row.facilityId, visitTypeCode: row.visitTypeCode, serviceDate: row.serviceDate };
  }

  labOrder(organizationId: string, orderId: string): Promise<BillableLabOrder | undefined> {
    return this.lab.billableOrder(organizationId, orderId);
  }
}
