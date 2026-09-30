import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { DATABASE, type Database, localDate, localDayBounds } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { appointment } from "../clinic.schema";
import { BookingRulesService } from "../config/booking-rules.service";
import { autoNoShowDue } from "../domain/patient-booking";
import { AppointmentService } from "./appointment.service";

const HOUR_MS = 3_600_000;
/** Only the last days are looked at: turning the rule on never reaches into old history. */
const LOOK_BACK_MS = 48 * HOUR_MS;

/**
 * Automatic no-shows (docs/domains/clinic.md, "Automatic no-shows and online check-in"), hourly: at facilities that
 * turned it on, booked or confirmed appointments that ended without a check-in are marked as no-shows once the local
 * time is past the facility's hour on the appointment's day — the same transition, audit (`automatic: true`) and
 * `AppointmentNoShow` follow-up as staff recording it. Each appointment is locked and re-checked, so running on several
 * API instances marks it once.
 */
@Injectable()
export class AutomaticNoShows implements OnApplicationShutdown {
  private readonly logger = new Logger(AutomaticNoShows.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly rules: BookingRulesService,
    private readonly appointments: AppointmentService,
    private readonly organizations: OrganizationService,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Automatic no-shows failed: ${String(error)}`);
    }
  }

  /** Marks what is due now. Returns how many appointments were marked. */
  async run(now = new Date()): Promise<{ marked: number }> {
    let marked = 0;
    for (const { organizationId, facilityId, rules } of await this.rules.withAutoNoShow()) {
      const facility = await this.organizations.getFacility(organizationId, facilityId);
      const rows = await this.db
        .select({ id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt })
        .from(appointment)
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            eq(appointment.facilityId, facilityId),
            inArray(appointment.status, ["booked", "confirmed"]),
            lte(appointment.endsAt, now),
            gte(appointment.startsAt, new Date(now.getTime() - LOOK_BACK_MS)),
          ),
        )
        .limit(2000);
      for (const row of rows) {
        const dayStart = localDayBounds(localDate(row.startsAt, facility.timezone), facility.timezone).start;
        if (!autoNoShowDue({ endsAt: row.endsAt, dayStart }, now, rules)) continue;
        if (await this.appointments.markNoShowAutomatically(organizationId, facilityId, row.id, now)) marked += 1;
      }
    }
    return { marked };
  }
}
