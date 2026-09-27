import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ClinicQueries } from "@healthcare/clinic";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { LabOrderService } from "@healthcare/laboratory";
import { NotificationService } from "@healthcare/notification";
import { PatientRecordService } from "@healthcare/patient";

/**
 * Tells the ordering practitioner, in the app, when a critical result is
 * verified or a released result is corrected (libs/laboratory/CLAUDE.md).
 * Messages carry the order and patient numbers only. Patients are not told
 * yet: the portal does not show laboratory results until Phase 4.
 */
@Injectable()
export class LaboratoryNotifications implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly orders: LabOrderService,
    private readonly clinic: ClinicQueries,
    private readonly patients: PatientRecordService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("CriticalResultRaised", "laboratory.notify-critical", (event) => this.notify(event, "critical"));
    this.handlers.on("LaboratoryResultAmended", "laboratory.notify-corrected", (event) => this.notify(event, "corrected"));
  }

  private async notify(event: DomainEventRecord, kind: "critical" | "corrected"): Promise<void> {
    const orderId = event.payload["orderId"];
    if (typeof orderId !== "string") return;
    const target = await this.orders.noticeTarget(event.organizationId, orderId);
    // External and patient-requested orders have no practitioner in the platform; the laboratory calls them.
    if (!target?.orderingPractitionerId) return;
    const userId = await this.clinic.practitionerUserId(event.organizationId, target.orderingPractitionerId);
    if (!userId) return;
    const brief = (await this.patients.briefs(event.organizationId, [target.patientId])).get(target.patientId);
    if (!brief) return;
    await this.notifications.send(systemActor(event.organizationId, event.facilityId, "laboratory-notice"), {
      recipient: { type: "user", userId },
      channel: "in_app",
      templateKey: "lab.result-notice",
      variables: { kind, orderNumber: target.orderNumber, patientNumber: brief.patientNumber },
      // At-least-once delivery: one message per event.
      idempotencyKey: `lab-notice:${event.id}`,
    });
  }
}
