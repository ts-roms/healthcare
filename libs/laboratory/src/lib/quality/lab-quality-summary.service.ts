import { Inject, Injectable } from "@nestjs/common";
import { type Actor, DATABASE, type Database, localDate, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, ne, sql } from "drizzle-orm";
import { LabCompetencyService } from "./lab-competency.service";
import { LabEqaService } from "./lab-eqa.service";
import { LabQualityService } from "./lab-quality.service";
import { LabReagentService } from "./lab-reagent.service";
import { LabTemperatureService } from "./lab-temperature.service";
import { labNonconformance } from "./quality-management.schema";

/**
 * What needs the quality manager's attention at the selected facility, as counts for the dashboard: open
 * nonconformances, QC that blocks or is missing, instruments, temperatures, EQA rounds and staff competency.
 * Built from the same queries as the quality pages, so the dashboard and the pages always agree.
 */
@Injectable()
export class LabQualitySummaryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quality: LabQualityService,
    private readonly temperatures: LabTemperatureService,
    private readonly eqa: LabEqaService,
    private readonly competency: LabCompetencyService,
    private readonly reagents: LabReagentService,
    private readonly organizations: OrganizationService,
  ) {}

  async summary(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const [nonconformances, qc, instruments, units, surveys, staff, facility, loads] = await Promise.all([
      this.db
        .select({
          open: sql<number>`count(*)::int`,
          investigating: sql<number>`count(*) filter (where ${labNonconformance.status} = 'investigating')::int`,
          critical: sql<number>`count(*) filter (where ${labNonconformance.severity} = 'critical')::int`,
          major: sql<number>`count(*) filter (where ${labNonconformance.severity} = 'major')::int`,
        })
        .from(labNonconformance)
        .where(
          and(eq(labNonconformance.organizationId, actor.organizationId), eq(labNonconformance.facilityId, facilityId), ne(labNonconformance.status, "closed")),
        ),
      this.quality.status(actor),
      this.quality.listInstruments(actor, false),
      this.temperatures.units(actor, false),
      this.eqa.surveys(actor),
      this.competency.overview(actor),
      this.organizations.getFacility(actor.organizationId, facilityId),
      this.reagents.inUse(actor),
    ]);
    const today = localDate(new Date(), facility.timezone);
    const areas = staff.staff.flatMap((s) => s.areas);
    const nc = nonconformances[0];
    return {
      facilityId,
      date: today,
      nonconformances: {
        open: nc?.open ?? 0,
        investigating: nc?.investigating ?? 0,
        critical: nc?.critical ?? 0,
        major: nc?.major ?? 0,
      },
      qc: {
        /** Test–instrument pairs whose decisive run in the window is rejected. */
        rejected: qc.rows.filter((r) => r.decisiveRun?.status === "rejected").length,
        /** Pairs with a current target but no run in the window. */
        missing: qc.rows.filter((r) => !r.decisiveRun).length,
        /** Pairs on which patient results are refused now (QC, instrument status or an expired reagent lot). */
        resultsBlocked: qc.rows.filter((r) => !r.resultsAllowed).length,
      },
      instruments: {
        outOfService: instruments.filter((i) => i.status === "out_of_service").length,
        calibrationOverdue: instruments.filter((i) => i.calibrationOverdue).length,
      },
      reagents: {
        /** Loaded reagent lots with a tenth of their tests or less left (or used beyond their stated capacity). */
        low: loads.filter((l) => l.use.low).length,
      },
      temperatures: {
        readingsDue: units.filter((u) => u.status === "active" && u.readingDue).length,
        /** Active units whose latest reading is out of range. */
        outOfRangeNow: units.filter((u) => u.status === "active" && u.lastReading?.outOfRange).length,
        excursionsLast7Days: units.reduce((sum, u) => sum + u.excursionsLast7Days, 0),
      },
      eqa: {
        /** Rounds past their due date with no result reported. */
        overdue: surveys.filter((s) => s.status === "received" && s.dueOn !== null && s.dueOn < today).length,
        awaitingEvaluation: surveys.filter((s) => s.status === "reported").length,
      },
      competency: {
        required: staff.competencyRequired,
        due: areas.filter((a) => a.state === "due").length,
        notYetCompetent: areas.filter((a) => a.state === "not_yet_competent").length,
        /** Result-entering staff with no assessment at all. */
        staffNotAssessed: staff.staff.filter((s) => s.areas.length === 0).length,
      },
    };
  }
}
