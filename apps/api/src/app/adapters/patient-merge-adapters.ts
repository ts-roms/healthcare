import { Injectable } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { BillingRecordQueries, formatPeso } from "@healthcare/billing";
import { CarePlanService } from "@healthcare/care-plan";
import { ClinicQueries } from "@healthcare/clinic";
import { LabRecordQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import type { MergeWorkItem, PatientMergeContext } from "@healthcare/patient";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Patient merge → clinic, laboratory, billing, care plans and the staff directory: the work in progress filed under
 * the record to retire (ADR-0009), each with the screen that resolves it. Composed here so the patient library imports
 * no other domain.
 */
@Injectable()
export class AppPatientMergeContext implements PatientMergeContext {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly lab: LabRecordQueries,
    private readonly billing: BillingRecordQueries,
    private readonly carePlans: CarePlanService,
    private readonly organizations: OrganizationService,
    private readonly users: UsersService,
  ) {}

  async workInProgress(organizationId: string, patientId: string): Promise<MergeWorkItem[]> {
    const [clinic, orders, billing, plans, facilities] = await Promise.all([
      this.clinic.mergeWorkInProgress(organizationId, patientId),
      this.lab.openOrders(organizationId, patientId, 50),
      this.billing.mergeWorkInProgress(organizationId, patientId),
      this.carePlans.openPlansSummary(organizationId, patientId),
      this.organizations.listFacilities(organizationId),
    ]);
    const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? "another facility";
    const items: MergeWorkItem[] = [
      ...clinic.encounters.map((e): MergeWorkItem => ({
        kind: e.modality === "telemedicine" ? "online_consultation_in_progress" : "encounter_in_progress",
        id: e.id,
        label: `${e.modality === "telemedicine" ? "Online consultation" : "Consultation"} in progress with ${e.practitionerName}`,
        at: iso(e.startedAt),
        link: { type: "encounter", id: e.id },
      })),
      ...clinic.visits.map((v): MergeWorkItem => ({
        kind: "queue_visit",
        id: v.id,
        label: `Queue number ${v.queueNumber} on ${v.queueDate} (${v.status.replace(/_/g, " ")})`,
        at: iso(v.checkedInAt),
        link: { type: "visit", id: v.id },
      })),
      ...clinic.appointments.map((a): MergeWorkItem => ({
        kind: "upcoming_appointment",
        id: a.id,
        label: `${a.visitTypeName} appointment (${a.status})`,
        at: iso(a.startsAt),
        link: { type: "appointment", id: a.id },
      })),
      ...orders.map((o): MergeWorkItem => ({
        kind: "lab_order_open",
        id: o.id,
        label: `Laboratory order ${o.orderNumber}: ${o.tests.map((t) => t.testName).join(", ")}`,
        at: iso(o.orderedAt),
        link: { type: "lab_order", id: o.id },
      })),
      ...billing.drafts.map((d): MergeWorkItem => ({
        kind: "draft_invoice",
        id: d.id,
        label: `Draft invoice at ${facilityName(d.facilityId)}`,
        at: iso(d.createdAt),
        link: { type: "invoice", id: d.id },
      })),
      ...billing.pending.map((c): MergeWorkItem => ({
        kind: "uninvoiced_charge",
        id: c.id,
        label: `Charge not yet invoiced: ${c.description}`,
        at: iso(c.capturedAt),
        link: { type: "billing_patient", id: patientId },
      })),
      ...billing.balances.map((b): MergeWorkItem => ({
        kind: "account_balance",
        id: b.facilityId,
        label: `Deposit or credit balance of ${formatPeso(b.balance)} at ${facilityName(b.facilityId)}: apply or refund it first`,
        at: null,
        link: { type: "billing_patient", id: patientId },
      })),
      ...plans
        .filter((p) => p.status === "active")
        .map((p): MergeWorkItem => ({
          kind: "care_plan_active",
          id: p.id,
          label: `Active care plan "${p.title}": it stays under this number; its reminders are not sent after the merge`,
          at: null,
          link: { type: "care_plan", id: p.id },
        })),
    ];
    return items;
  }

  staffNames(organizationId: string, userIds: string[]) {
    return this.users.displayNames(organizationId, userIds);
  }
}
