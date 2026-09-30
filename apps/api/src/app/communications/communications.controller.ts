import { Controller, Get, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
import { type Actor, CurrentActor, RequirePermissions, toCsv } from "@healthcare/core";
import { type CommunicationLogEntry, CommunicationLogDto, CommunicationSummaryDto, NotificationService } from "@healthcare/notification";
import { PatientRecordService } from "@healthcare/patient";

/** The most rows one CSV export carries (a period of at most 92 days). */
export const COMMUNICATION_EXPORT_LIMIT = 5000;

/**
 * The communication log (docs/domains/notification.md, "Communication log"): what the platform sent, or did not send,
 * to patients across the organization, read from the notification library with the patient's number and name and the
 * requesting staff member's name added here. Never the message, its variables or the full destination. Viewing and
 * exporting are audited.
 */
@ApiTags("communications")
@ApiBearerAuth()
@Controller({ path: "communications", version: "1" })
export class CommunicationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly patients: PatientRecordService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("notification.read", "patient.read")
  @ApiOperation({ summary: "Messages to patients in a period with their delivery status (never the content; audited)" })
  async log(@CurrentActor() actor: Actor, @Query() query: CommunicationLogDto) {
    const page = await this.notifications.communicationLog(actor.organizationId, query);
    await this.audit.recordStandalone(actor, {
      action: "notification.log.view",
      resourceType: "notification",
      patientId: query.patientId,
      metadata: { ...this.filters(query), page: query.page, rows: page.items.length },
    });
    return { ...page, items: await this.withNames(actor, page.items) };
  }

  @Get("summary")
  @RequirePermissions("notification.read")
  @ApiOperation({ summary: "Counts of messages to patients in a period by status, channel, reason not sent and kind (no patients)" })
  summary(@CurrentActor() actor: Actor, @Query() query: CommunicationSummaryDto) {
    return this.notifications.communicationSummary(actor.organizationId, query.from, query.to);
  }

  @Get("export")
  @RequirePermissions("notification.read", "patient.read")
  @ApiOperation({ summary: `The log as CSV, at most ${COMMUNICATION_EXPORT_LIMIT} rows (formula-safe; audited)` })
  async export(@CurrentActor() actor: Actor, @Query() query: CommunicationLogDto): Promise<StreamableFile> {
    const page = await this.notifications.communicationLog(actor.organizationId, { ...query, page: 1, pageSize: COMMUNICATION_EXPORT_LIMIT });
    const items = await this.withNames(actor, page.items);
    const rows: Array<Array<string | number | null>> = [
      ["Period", `${query.from} to ${query.to}`],
      ...(page.hasMore ? [[`Only the latest ${COMMUNICATION_EXPORT_LIMIT} messages; narrow the filters for the rest`]] : []),
      [],
      [
        "Created",
        "Patient number",
        "Patient",
        "Message",
        "Category",
        "Channel",
        "Status",
        "Reason not sent",
        "To",
        "Attempts",
        "Sent",
        "Delivered",
        "Failed",
        "Requested by",
      ],
      ...items.map((i) => [
        i.createdAt.toISOString(),
        i.patient?.patientNumber ?? null,
        i.patient?.displayName ?? null,
        i.templateLabel,
        i.category,
        i.channel,
        i.status,
        i.suppressionReason,
        i.destinationMasked,
        i.attemptCount,
        i.sentAt?.toISOString() ?? null,
        i.deliveredAt?.toISOString() ?? null,
        i.failedAt?.toISOString() ?? null,
        i.requestedByName ?? (i.requestedBy ? null : "Sent by the platform"),
      ]),
    ];
    await this.audit.recordStandalone(actor, {
      action: "notification.log.export",
      resourceType: "notification",
      patientId: query.patientId,
      metadata: { ...this.filters(query), rows: items.length, truncated: page.hasMore },
    });
    const body = Buffer.from(`﻿${toCsv(rows)}`, "utf8");
    const filename = `communications-${query.from}-to-${query.to}.csv`;
    return new StreamableFile(body, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"`, length: body.length });
  }

  private filters(query: CommunicationLogDto) {
    return {
      from: query.from,
      to: query.to,
      channel: query.channel ?? null,
      category: query.category ?? null,
      status: query.status ?? null,
      templateKey: query.templateKey ?? null,
    };
  }

  private async withNames(actor: Actor, items: CommunicationLogEntry[]) {
    const [briefs, names] = await Promise.all([
      this.patients.briefs(actor.organizationId, [...new Set(items.map((i) => i.patientId))]),
      this.users.displayNames(actor.organizationId, [...new Set(items.flatMap((i) => (i.requestedBy ? [i.requestedBy] : [])))]),
    ]);
    return items.map((i) => {
      const brief = briefs.get(i.patientId);
      return {
        ...i,
        patient: brief ? { id: i.patientId, patientNumber: brief.patientNumber, displayName: brief.displayName } : null,
        requestedByName: i.requestedBy ? (names.get(i.requestedBy) ?? null) : null,
      };
    });
  }
}
