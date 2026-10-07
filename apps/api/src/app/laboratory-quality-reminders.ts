import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { UsersService } from "@healthcare/auth";
import { asPlatform, DATABASE, type Database, systemActor } from "@healthcare/core";
import { LabQualityDue } from "@healthcare/laboratory";
import { NotificationService } from "@healthcare/notification";
import { sql } from "drizzle-orm";

const HOUR_MS = 3_600_000;

type Person = { id: string; displayName: string };

/**
 * Laboratory quality reminders (docs/domains/laboratory-quality.md), hourly: an in-app `lab.quality-notice` to the
 * facility's quality managers (`lab.qc.manage`) when a storage unit misses its temperature reading — once per missed
 * reading, until one is recorded — and when a staff member's competency reassessment is past due — once per
 * assessment, also to that person while they still enter results at the facility. Safe on several API instances
 * (advisory lock; idempotency keys make every message once-only).
 */
@Injectable()
export class LaboratoryQualityReminders implements OnApplicationShutdown {
  private readonly logger = new Logger(LaboratoryQualityReminders.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly due: LabQualityDue,
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("laboratory quality reminders", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Laboratory quality reminders failed: ${String(error)}`);
    }
  }

  /** Sends what is due now. Returns how many readings and reassessments were found due. */
  async run(now = new Date()): Promise<{ temperatures: number; competencies: number }> {
    return this.db.transaction(async (tx) => {
      // One runner at a time across instances; the others skip this round.
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('laboratory-quality-reminders')) AS locked`);
      if (!lock.rows[0]?.locked) return { temperatures: 0, competencies: 0 };
      const [temperatures, competencies] = await Promise.all([this.due.temperatureReadingsDue(now), this.due.competencyReassessmentsDue(now)]);
      const people = new Map<string, Promise<Person[]>>();
      const holders = (organizationId: string, facilityId: string, permission: string) => {
        const key = `${organizationId}:${facilityId}:${permission}`;
        let list = people.get(key);
        if (!list) people.set(key, (list = this.users.holdersOf(organizationId, permission, facilityId)));
        return list;
      };

      for (const unit of temperatures) {
        const managers = await holders(unit.organizationId, unit.facilityId, "lab.qc.manage");
        for (const manager of managers) {
          await this.send(unit.organizationId, unit.facilityId, manager.id, `lab-temp-due:${unit.storageUnitId}:${unit.lastReadingId ?? "none"}`, {
            kind: "temperature_due",
            storageUnitCode: unit.code,
            storageUnitName: unit.name.slice(0, 80),
          });
        }
      }

      for (const item of competencies) {
        // Only people who still enter results at the facility are reassessed there.
        const person = (await holders(item.organizationId, item.facilityId, "lab.result.enter")).find((p) => p.id === item.userId);
        if (!person) continue;
        const variables = { kind: "competency_due", staffName: person.displayName.slice(0, 80), areaName: item.areaName.slice(0, 80), dueOn: item.nextDueOn };
        const key = `lab-competency-due:${item.assessmentId}`;
        await this.send(item.organizationId, item.facilityId, person.id, key, { ...variables, forSelf: true });
        for (const manager of await holders(item.organizationId, item.facilityId, "lab.qc.manage")) {
          if (manager.id !== person.id) await this.send(item.organizationId, item.facilityId, manager.id, key, { ...variables, forSelf: false });
        }
      }
      return { temperatures: temperatures.length, competencies: competencies.length };
    });
  }

  private async send(organizationId: string, facilityId: string, userId: string, key: string, variables: Record<string, unknown>): Promise<void> {
    await this.notifications.send(systemActor(organizationId, facilityId, "laboratory-quality-reminder"), {
      recipient: { type: "user", userId },
      channel: "in_app",
      templateKey: "lab.quality-notice",
      variables,
      // Once per missed reading or due reassessment and recipient, whichever instance or hour finds it.
      idempotencyKey: `${key}:${userId}`,
    });
  }
}
