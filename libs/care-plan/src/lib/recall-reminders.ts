import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { asPlatform, DATABASE, type Database, localTime, PH_TIMEZONE, systemActor, todayInPhilippines } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { nextDueDate, RECALL_KINDS, RECALL_RULES, recallReminderKind, withinSendingHours } from "./care-plan.rules";
import { carePlan, carePlanActivity, carePlanActivityReminder } from "./care-plan.schema";

const HOUR_MS = 3_600_000;

interface Due {
  organizationId: string;
  patientId: string;
  activityId: string;
  dueDate: string;
  kind: "due" | "overdue";
}

/**
 * Patient recall (CLAUDE.md §39): reminds patients of follow-up visits and
 * laboratory monitoring their care plan has due and that nobody has booked
 * yet — once a week before the due date, once more a week after, then the care
 * team takes over from the recall list. One message per patient per day (SMS
 * and the MyHealth inbox), naming no condition, test or plan; consent and
 * communication preferences are applied by NotificationService (category
 * "clinical", so patients can opt out). Runs hourly in daytime; safe to run
 * on several API instances (advisory lock, idempotency keys, reminder log).
 */
@Injectable()
export class CarePlanRecallReminders implements OnApplicationShutdown {
  private readonly logger = new Logger(CarePlanRecallReminders.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
  ) {}

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("care-plan recall reminders", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Recall reminders failed: ${String(error)}`);
    }
  }

  /** Sends today's reminders. Returns how many patients were messaged and activities covered. */
  async run(now = new Date()): Promise<{ patients: number; activities: number }> {
    if (!withinSendingHours(Number(localTime(now, PH_TIMEZONE).slice(0, 2)))) return { patients: 0, activities: 0 };
    return this.db.transaction(async (tx) => {
      // One runner at a time across instances; the others skip this round.
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('care-plan-recall-reminders')) AS locked`);
      if (!lock.rows[0]?.locked) return { patients: 0, activities: 0 };
      const due = await this.findDue(now);
      const byPatient = new Map<string, Due[]>();
      for (const item of due)
        byPatient.set(`${item.organizationId}:${item.patientId}`, [...(byPatient.get(`${item.organizationId}:${item.patientId}`) ?? []), item]);
      for (const items of byPatient.values()) await this.remind(items, now);
      return { patients: byPatient.size, activities: due.length };
    });
  }

  /** Open, unbooked follow-ups in their reminder window that have not had this reminder yet. */
  private async findDue(now: Date): Promise<Due[]> {
    const today = todayInPhilippines(now);
    const rows = await this.db
      .select({
        organizationId: carePlanActivity.organizationId,
        patientId: carePlanActivity.patientId,
        activityId: carePlanActivity.id,
        dueDate: carePlanActivity.dueDate,
      })
      .from(carePlanActivity)
      .innerJoin(carePlan, eq(carePlan.id, carePlanActivity.carePlanId))
      .where(
        and(
          eq(carePlanActivity.status, "planned"),
          isNull(carePlanActivity.linkedAppointmentId),
          inArray(carePlanActivity.kind, [...RECALL_KINDS]),
          eq(carePlan.status, "active"),
          gte(carePlanActivity.dueDate, nextDueDate(today, -RECALL_RULES.giveUpAfterDays)),
          lte(carePlanActivity.dueDate, nextDueDate(today, RECALL_RULES.dueWindowDays)),
        ),
      )
      .limit(5000);
    const candidates = rows.flatMap((r) => {
      const kind = r.dueDate ? recallReminderKind(r.dueDate, today) : null;
      return kind && r.dueDate ? [{ ...r, dueDate: r.dueDate, kind }] : [];
    });
    if (candidates.length === 0) return [];
    const sent = await this.db
      .select({ activityId: carePlanActivityReminder.activityId, dueDate: carePlanActivityReminder.dueDate, kind: carePlanActivityReminder.kind })
      .from(carePlanActivityReminder)
      .where(inArray(carePlanActivityReminder.activityId, [...new Set(candidates.map((c) => c.activityId))]));
    const done = new Set(sent.map((s) => `${s.activityId}:${s.dueDate}:${s.kind}`));
    return candidates.filter((c) => !done.has(`${c.activityId}:${c.dueDate}:${c.kind}`));
  }

  private async remind(items: Due[], now: Date): Promise<void> {
    const first = items[0];
    if (!first) return;
    const overdue = items.filter((i) => i.kind === "overdue");
    // An overdue follow-up is the more pressing message; otherwise the earliest one due.
    const lead = (overdue.length ? overdue : items).reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
    const organization = await this.organizations.getOrganization(first.organizationId);
    const actor = systemActor(first.organizationId, null, "care-plan-recall");
    const variables = { kind: lead.kind, organizationName: organization.name.slice(0, 80), date: calendarDate(lead.dueDate) };
    const key = `care-recall:${first.patientId}:${todayInPhilippines(now)}`;
    let notificationId: string | null = null;
    for (const channel of ["sms", "in_app"] as const) {
      const sent = await this.notifications.send(actor, {
        recipient: { type: "patient", patientId: first.patientId },
        channel,
        templateKey: "care-plan.follow-up-due",
        variables,
        idempotencyKey: `${key}:${channel}`,
      });
      notificationId ??= sent.id;
    }
    await this.db
      .insert(carePlanActivityReminder)
      .values(
        items.map((i) => ({
          organizationId: i.organizationId,
          patientId: i.patientId,
          activityId: i.activityId,
          dueDate: i.dueDate,
          kind: i.kind,
          notificationId,
        })),
      )
      .onConflictDoNothing();
  }
}

/** "Oct 10, 2026" for a calendar date. */
function calendarDate(date: string): string {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
