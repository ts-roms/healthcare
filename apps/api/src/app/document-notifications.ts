import { Injectable, type OnModuleInit } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { DocumentRecordQueries } from "@healthcare/documents";
import { NotificationService } from "@healthcare/notification";

/** Who hears that a file was quarantined: the people who manage documents at the facility, and the staff uploader. */
const DOCUMENT_MANAGER_PERMISSION = "document.archive";

/**
 * Tells the facility's records office, in the app, when an upload is quarantined by the malware scanner
 * (docs/domains/documents.md): the signature name and whether it came from MyHealth or a staff upload, never the file
 * or its title. The staff member who uploaded it is told as well. Likewise when an integrity review finds a stored
 * document whose bytes no longer match their checksum, or whose file is missing (migration 0105). Idempotent per
 * event and recipient.
 */
@Injectable()
export class DocumentNotifications implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly users: UsersService,
    private readonly documents: DocumentRecordQueries,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("DocumentQuarantined", "documents.notify-quarantine", (event) => this.quarantined(event));
    this.handlers.on("DocumentIntegrityFailed", "documents.notify-integrity", (event) => this.integrityFailed(event));
  }

  private async integrityFailed(event: DomainEventRecord): Promise<void> {
    const payload = event.payload as { findingId?: string; outcome?: string };
    if (!payload.findingId || (payload.outcome !== "mismatch" && payload.outcome !== "missing")) return;
    const facilityId = event.facilityId ?? null;
    const managers = await this.users.holdersOf(event.organizationId, DOCUMENT_MANAGER_PERMISSION, facilityId);
    const actor = systemActor(event.organizationId, facilityId, "document-integrity-notice");
    for (const { id: userId } of managers) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId },
        channel: "in_app",
        templateKey: "document.integrity-notice",
        variables: { documentId: event.aggregateId, findingId: payload.findingId, outcome: payload.outcome, patientId: event.patientId ?? null },
        idempotencyKey: `document-integrity:${event.id}:${userId}`,
      });
    }
  }

  private async quarantined(event: DomainEventRecord): Promise<void> {
    const quarantine = await this.documents.quarantine(event.organizationId, event.aggregateId);
    if (!quarantine) return;
    const facilityId = event.facilityId ?? null;
    const managers = await this.users.holdersOf(event.organizationId, DOCUMENT_MANAGER_PERMISSION, facilityId);
    const recipients = new Set(managers.map((m) => m.id));
    if (quarantine.createdBy) recipients.add(quarantine.createdBy);
    const actor = systemActor(event.organizationId, facilityId, "document-quarantine-notice");
    for (const userId of recipients) {
      await this.notifications.send(actor, {
        recipient: { type: "user", userId },
        channel: "in_app",
        templateKey: "document.quarantine-notice",
        variables: {
          documentId: event.aggregateId,
          signature: quarantine.signature.slice(0, 80),
          origin: quarantine.source === "patient_upload" ? "patient_portal" : "staff",
          patientId: event.patientId ?? null,
        },
        idempotencyKey: `document-quarantine:${event.id}:${userId}`,
      });
    }
  }
}
