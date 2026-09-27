import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
import { appointment, diagnosis, encounter, vitalSignSet } from "./clinic.schema";
import { publicView } from "./clinic-support";
import { ClinicConfigService } from "./config/clinic-config.service";
import { TriageService, toVitalsView } from "./triage/triage.service";

/**
 * Read-only queries other domains may use through app-level adapters
 * (prescribing context, Patient 360). No auditing here: callers audit the
 * user-facing access they serve.
 */
@Injectable()
export class ClinicQueries {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ClinicConfigService,
    private readonly triage: TriageService,
  ) {}

  practitionerForUser(organizationId: string, userId: string) {
    return this.config.practitionerForUser(organizationId, userId);
  }

  async encounter(organizationId: string, encounterId: string) {
    const [row] = await this.db
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    return row;
  }

  allergySummary(organizationId: string, patientId: string) {
    return this.triage.allergySummary(organizationId, patientId);
  }

  /** Clinical snapshot for Patient 360: allergies, problem list, recent care, latest vitals, upcoming visits. */
  async clinicalSummary(organizationId: string, patientId: string) {
    const [allergies, problems, encounters, vitals, upcoming] = await Promise.all([
      this.allergySummary(organizationId, patientId),
      this.db
        .select()
        .from(diagnosis)
        .where(
          and(
            eq(diagnosis.organizationId, organizationId),
            eq(diagnosis.patientId, patientId),
            eq(diagnosis.status, "active"),
            or(eq(diagnosis.isChronic, true), gte(diagnosis.recordedAt, new Date(Date.now() - 90 * 86_400_000))),
          ),
        )
        .orderBy(desc(diagnosis.isChronic), desc(diagnosis.recordedAt))
        .limit(50),
      this.db
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, organizationId), eq(encounter.patientId, patientId), inArray(encounter.status, ["in_progress", "completed"])))
        .orderBy(desc(encounter.startedAt))
        .limit(5),
      this.db
        .select()
        .from(vitalSignSet)
        .where(and(eq(vitalSignSet.organizationId, organizationId), eq(vitalSignSet.patientId, patientId), eq(vitalSignSet.status, "final")))
        .orderBy(desc(vitalSignSet.measuredAt))
        .limit(3),
      this.db
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            eq(appointment.patientId, patientId),
            inArray(appointment.status, ["booked", "confirmed"]),
            gte(appointment.startsAt, new Date()),
          ),
        )
        .orderBy(asc(appointment.startsAt))
        .limit(5),
    ]);
    return {
      allergies,
      problemList: problems.map(publicView),
      recentEncounters: encounters.map(publicView),
      latestVitals: vitals.map(toVitalsView),
      upcomingAppointments: upcoming.map(publicView),
    };
  }
}
