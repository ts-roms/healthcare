import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { AccessService, UsersService } from "@healthcare/auth";
import { type Actor, CurrentActor, ForbiddenError, NotFoundError, RequirePermissions, toCsv } from "@healthcare/core";
import {
  type CommunicationLogEntry,
  CommunicationLogDto,
  CommunicationReasonDto,
  CommunicationSummaryDto,
  type FacilityScope,
  NotificationService,
} from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";

/** The most rows one CSV export carries (a period of at most 92 days). */
export const COMMUNICATION_EXPORT_LIMIT = 5000;

const LOG_PERMISSION = "notification.read";

/**
 * The communication log (docs/domains/notification.md, "Communication log"): what the platform sent, or did not send,
 * to patients across the organization, read from the notification library with the patient's number and name, the
 * facility's name and the requesting staff member's name added here. A member whose `notification.read` is scoped to
 * facilities sees only those facilities' messages (migration 0106). Never the message, its variables or the full
 * destination. Viewing and exporting are audited.
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
    private readonly access: AccessService,
    private readonly organizations: OrganizationService,
  ) {}

  @Get()
  @RequirePermissions("notification.read", "patient.read")
  @ApiOperation({ summary: "Messages to patients in a period with their delivery status (never the content; audited)" })
  async log(@CurrentActor() actor: Actor, @Query() query: CommunicationLogDto) {
    const { scope, facilities } = await this.scope(actor, query.facilityId, "notification.log.view");
    const page = await this.notifications.communicationLog(actor.organizationId, query, scope);
    await this.audit.recordStandalone(actor, {
      action: "notification.log.view",
      resourceType: "notification",
      patientId: query.patientId,
      metadata: { ...this.filters(query), scope, page: query.page, rows: page.items.length },
    });
    return { ...page, scope, items: await this.withNames(actor, page.items, facilities) };
  }

  @Get("summary")
  @RequirePermissions("notification.read")
  @ApiOperation({ summary: "Counts of messages to patients in a period by status, channel, reason not sent and kind (no patients)" })
  async summary(@CurrentActor() actor: Actor, @Query() query: CommunicationSummaryDto) {
    const { scope } = await this.scope(actor, query.facilityId, "notification.log.view");
    return { ...(await this.notifications.communicationSummary(actor.organizationId, query.from, query.to, scope, query.facilityId)), scope };
  }

  @Get("export")
  @RequirePermissions("notification.read", "patient.read")
  @ApiOperation({ summary: `The log as CSV, at most ${COMMUNICATION_EXPORT_LIMIT} rows (formula-safe; audited)` })
  async export(@CurrentActor() actor: Actor, @Query() query: CommunicationLogDto): Promise<StreamableFile> {
    const { scope, facilities } = await this.scope(actor, query.facilityId, "notification.log.export");
    const page = await this.notifications.communicationLog(actor.organizationId, { ...query, page: 1, pageSize: COMMUNICATION_EXPORT_LIMIT }, scope);
    const items = await this.withNames(actor, page.items, facilities);
    const rows: Array<Array<string | number | null>> = [
      ["Period", `${query.from} to ${query.to}`],
      ...(page.hasMore ? [[`Only the latest ${COMMUNICATION_EXPORT_LIMIT} messages; narrow the filters for the rest`]] : []),
      [],
      [
        "Created",
        "Facility",
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
        i.facilityName ?? (i.facilityId ? null : "Not recorded"),
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
      metadata: { ...this.filters(query), scope, rows: items.length, truncated: page.hasMore },
    });
    const body = Buffer.from(`\uFEFF${toCsv(rows)}`, "utf8");
    const filename = `communications-${query.from}-to-${query.to}.csv`;
    return new StreamableFile(body, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"`, length: body.length });
  }

  @Post(":notificationId/cancel")
  @HttpCode(200)
  @RequirePermissions("notification.manage")
  @ApiOperation({ summary: "Cancel a message to a patient not yet sent, with a reason (audited)" })
  cancel(@CurrentActor() actor: Actor, @Param("notificationId", ParseUUIDPipe) notificationId: string, @Body() body: CommunicationReasonDto) {
    return this.notifications.cancel(actor, notificationId, body.reason);
  }

  @Post(":notificationId/resend")
  @HttpCode(201)
  @RequirePermissions("notification.manage")
  @ApiOperation({ summary: "Send again a message that was not sent: a new message, consent and preferences re-checked (audited)" })
  resend(@CurrentActor() actor: Actor, @Param("notificationId", ParseUUIDPipe) notificationId: string, @Body() body: CommunicationReasonDto) {
    return this.notifications.resend(actor, notificationId, body.reason);
  }

  private filters(query: CommunicationLogDto) {
    return {
      from: query.from,
      to: query.to,
      channel: query.channel ?? null,
      category: query.category ?? null,
      status: query.status ?? null,
      templateKey: query.templateKey ?? null,
      facilityId: query.facilityId ?? null,
    };
  }

  /**
   * The facilities the reader may see (null: every one, for an organization-wide `notification.read`), and that a
   * requested facility exists and is among them — a facility outside the scope is refused and audited as a denial.
   */
  private async scope(actor: Actor, facilityId: string | undefined, action: string): Promise<{ scope: FacilityScope; facilities: Map<string, string> }> {
    const [grants, all] = await Promise.all([
      this.access.grantsFor(actor.userId, actor.organizationId),
      this.organizations.listFacilities(actor.organizationId),
    ]);
    const facilities = new Map(all.map((f) => [f.id, f.name]));
    const relevant = grants.filter((g) => g.permissionKey === LOG_PERMISSION);
    const scope: FacilityScope = relevant.some((g) => g.facilityId === null)
      ? null
      : [...new Set(relevant.flatMap((g) => (g.facilityId && facilities.has(g.facilityId) ? [g.facilityId] : [])))];
    if (facilityId) {
      if (!facilities.has(facilityId)) throw new NotFoundError("Facility");
      if (scope && !scope.includes(facilityId)) {
        await this.audit.recordStandalone(actor, {
          action,
          resourceType: "notification",
          outcome: "denied",
          reason: "facility_out_of_scope",
          metadata: { facilityId, scope },
        });
        throw new ForbiddenError("You may not view this facility's communications");
      }
    }
    return { scope, facilities };
  }

  private async withNames(actor: Actor, items: CommunicationLogEntry[], facilities: Map<string, string>) {
    const [briefs, names] = await Promise.all([
      this.patients.briefs(actor.organizationId, [...new Set(items.map((i) => i.patientId))]),
      this.users.displayNames(actor.organizationId, [...new Set(items.flatMap((i) => (i.requestedBy ? [i.requestedBy] : [])))]),
    ]);
    return items.map((i) => {
      const brief = briefs.get(i.patientId);
      return {
        ...i,
        patient: brief ? { id: i.patientId, patientNumber: brief.patientNumber, displayName: brief.displayName } : null,
        facilityName: i.facilityId ? (facilities.get(i.facilityId) ?? null) : null,
        requestedByName: i.requestedBy ? (names.get(i.requestedBy) ?? null) : null,
      };
    });
  }
}
