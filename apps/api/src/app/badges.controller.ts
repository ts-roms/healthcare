import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "@healthcare/core";
import { DohReportsService } from "@healthcare/interoperability";
import { LabResultService } from "@healthcare/laboratory";
import { PatientMessageService, RecordsRequestService } from "@healthcare/patient";

/** What the staff navigation shows a number for; null when the user may not see that module or no facility is selected. */
export interface StaffBadges {
  /** Conversations waiting for the clinic, and those past their response target (`patient.message.read`). */
  messagesAwaiting: number | null;
  messagesOverdue: number | null;
  /** Critical results at the selected facility not yet acknowledged (`lab.result.read`). */
  criticalResults: number | null;
  /** Open records requests (`patient.records-request.manage`). */
  recordsRequests: number | null;
  /** DOH case reports awaiting review (`doh.report.manage`). */
  caseReports: number | null;
}

/**
 * Counts for the staff navigation (docs/domains/notification.md, "Module badges"): each from its domain's own count,
 * only with that domain's read permission, facility-scoped where the domain is. Counts only — no patient is read, so
 * nothing is audited here; opening the module is.
 */
@ApiTags("me")
@ApiBearerAuth()
@Controller({ path: "me/badges", version: "1" })
export class BadgesController {
  constructor(
    private readonly messages: PatientMessageService,
    private readonly results: LabResultService,
    private readonly records: RecordsRequestService,
    private readonly doh: DohReportsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Counts for the navigation: messages awaiting and overdue, critical results, records requests, case reports" })
  async badges(@CurrentActor() actor: Actor): Promise<StaffBadges> {
    const may = (permission: string) => actor.permissions.has(permission);
    const [messagesAwaiting, messagesOverdue, criticalResults, recordsRequests, caseReports] = await Promise.all([
      may("patient.message.read") ? this.messages.awaitingCount(actor) : null,
      may("patient.message.read") ? this.messages.overdueCount(actor) : null,
      may("lab.result.read") ? this.results.countUnacknowledgedCritical(actor) : null,
      may("patient.records-request.manage") ? this.records.countOpen(actor) : null,
      may("doh.report.manage") ? this.doh.countPendingReview(actor) : null,
    ]);
    return { messagesAwaiting, messagesOverdue, criticalResults, recordsRequests, caseReports };
  }
}
