import { Injectable, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { LabQualityService, LabReagentService } from "@healthcare/laboratory";
import { NotificationService } from "@healthcare/notification";

/** Who hears about the laboratory's quality events: staff who manage quality at the event's facility. */
const QUALITY_MANAGER_PERMISSION = "lab.qc.manage";

/**
 * Tells the facility's quality managers, in the app, when a nonconformance is
 * opened (by staff, a temperature excursion or an unacceptable EQA result) or
 * a QC run is rejected (the person whose action raised it is not told again),
 * and once per loaded reagent lot when it runs low (every quality manager).
 * Messages carry record numbers, the instrument and the test — never patient,
 * specimen or control values.
 */
@Injectable()
export class LaboratoryQualityNotifications implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly users: UsersService,
    private readonly quality: LabQualityService,
    private readonly reagents: LabReagentService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("LaboratoryNonconformanceOpened", "laboratory.notify-nonconformance", (event) => this.nonconformanceOpened(event));
    this.handlers.on("LaboratoryQcRunRejected", "laboratory.notify-qc-rejected", (event) => this.qcRejected(event));
    this.handlers.on("LaboratoryReagentLow", "laboratory.notify-reagent-low", (event) => this.reagentLow(event));
  }

  private async reagentLow(event: DomainEventRecord): Promise<void> {
    const { loadId } = event.payload;
    if (typeof loadId !== "string") return;
    const alert = await this.reagents.lowAlertSummary(event.organizationId, loadId);
    // Unloaded before the notice went out: the lot has been replaced already.
    if (!alert || alert.unloaded) return;
    await this.tell(event, null, {
      kind: "reagent_low",
      instrumentCode: alert.instrumentCode,
      itemName: alert.itemName.slice(0, 80),
      lotNumber: alert.lotNumber ? alert.lotNumber.slice(0, 80) : null,
      remaining: alert.remaining,
      capacity: alert.capacity,
    });
  }

  private async nonconformanceOpened(event: DomainEventRecord): Promise<void> {
    const { number, category, severity, reportedBy } = event.payload;
    await this.tell(event, typeof reportedBy === "string" ? reportedBy : null, {
      kind: "nonconformance",
      nonconformanceId: event.aggregateId,
      number,
      category,
      severity,
    });
  }

  private async qcRejected(event: DomainEventRecord): Promise<void> {
    const summary = await this.quality.runSummary(event.organizationId, event.aggregateId);
    if (!summary) return;
    const { violations, enteredBy } = event.payload;
    await this.tell(event, typeof enteredBy === "string" ? enteredBy : null, {
      kind: "qc_rejected",
      instrumentCode: summary.instrumentCode,
      testName: summary.testName,
      rules: Array.isArray(violations) ? violations.filter((v): v is string => typeof v === "string") : [],
    });
  }

  private async tell(event: DomainEventRecord, raisedBy: string | null, variables: Record<string, unknown>): Promise<void> {
    if (!event.facilityId) return;
    const managers = await this.users.holdersOf(event.organizationId, QUALITY_MANAGER_PERMISSION, event.facilityId);
    const actor = systemActor(event.organizationId, event.facilityId, "laboratory-quality-notice");
    for (const manager of managers) {
      if (manager.id === raisedBy) continue;
      await this.notifications.send(actor, {
        recipient: { type: "user", userId: manager.id },
        channel: "in_app",
        templateKey: "lab.quality-notice",
        variables,
        // At-least-once delivery: one message per event and recipient.
        idempotencyKey: `lab-quality:${event.id}:${manager.id}`,
      });
    }
  }
}
