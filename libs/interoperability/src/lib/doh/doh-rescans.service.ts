import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPlatform,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  localDate,
  localDayBounds,
  NotFoundError,
  systemActor,
} from "@healthcare/core";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { rescanSchema } from "./doh.dto";
import { isIcd10, matchRule, rescanRangeProblem } from "./doh.rules";
import { dohCaseReport, dohRescan, type RescanRecord } from "./doh.schema";
import { DohReportsService } from "./doh-reports.service";
import { DohSettingsService } from "./doh-settings.service";
import { DOH_CASE_SOURCES, type DohCaseSources } from "./ports";

/** Diagnoses read per page; progress (counts and the cursor) is saved after each page. */
const PAGE_SIZE = 500;
/** A running check whose heartbeat is older than this was interrupted (e.g. an API restart) and is resumed. */
const STALE_AFTER_MS = 5 * 60_000;
/** Runs (first run and resumptions) before a check is recorded as failed. */
export const RESCAN_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 15_000;

/**
 * Checks of earlier diagnoses: detection only sees diagnoses recorded after a rule exists, so staff who add a rule can
 * ask for the organization's diagnoses recorded in a date range (at most 90 days) to be checked against the active
 * rules. The check runs in the background (a poller in the API, one check at a time per organization, resumable from
 * its cursor, safe on several API instances) and opens case reports exactly as detection does — one per diagnosis, so
 * running it again, or over a diagnosis already detected, opens nothing twice. The rules stay the organization's own.
 */
@Injectable()
export class DohRescans implements OnApplicationShutdown {
  private readonly logger = new Logger(DohRescans.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DOH_CASE_SOURCES) private readonly sources: DohCaseSources,
    private readonly settings: DohSettingsService,
    private readonly reports: DohReportsService,
    private readonly audit: AuditService,
  ) {}

  /** Queues a check of the organization's diagnoses recorded from `from` to `to` (calendar dates in the requester's facility time zone, both included). */
  async request(actor: Actor, input: z.infer<typeof rescanSchema>, now = new Date()) {
    const timeZone = await this.sources.timeZone(actor.organizationId, actor.facilityId ?? null);
    const problem = rescanRangeProblem(input.from, input.to, localDate(now, timeZone));
    if (problem) throw new BusinessRuleError(problem, "rescan_range");
    const rules = await this.settings.rules(actor.organizationId, true);
    if (rules.length === 0) throw new BusinessRuleError("No reportable conditions are active: add the rules first", "no_active_rules");
    const row = await this.db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(dohRescan)
        .values({ organizationId: actor.organizationId, fromDate: input.from, toDate: input.to, timeZone, requestedBy: actor.userId })
        // One check at a time per organization (doh_rescan_one_open).
        .onConflictDoNothing()
        .returning()) as RescanRecord[];
      if (!inserted) throw new ConflictError("A check of earlier diagnoses is already in progress", undefined, "rescan_in_progress");
      await this.audit.record(tx, actor, {
        action: "doh.rescan.request",
        resourceType: "doh_rescan",
        resourceId: inserted.id,
        metadata: { from: input.from, to: input.to, timeZone, activeRules: rules.length },
      });
      return inserted;
    });
    this.kick();
    return view(row);
  }

  /** The organization's recent checks, newest first, with the time zone a new check would use and today's date there. */
  async list(actor: Actor, now = new Date()) {
    const [timeZone, rows] = await Promise.all([
      this.sources.timeZone(actor.organizationId, actor.facilityId ?? null),
      this.db.select().from(dohRescan).where(eq(dohRescan.organizationId, actor.organizationId)).orderBy(desc(dohRescan.requestedAt)).limit(10),
    ]);
    return { timeZone, today: localDate(now, timeZone), rescans: rows.map(view) };
  }

  async get(actor: Actor, rescanId: string) {
    const [row] = await this.db
      .select()
      .from(dohRescan)
      .where(and(eq(dohRescan.organizationId, actor.organizationId), eq(dohRescan.id, rescanId)));
    if (!row) throw new NotFoundError("Check of earlier diagnoses");
    return view(row);
  }

  /** Polls for queued (and interrupted) checks. Called once at API start-up. */
  start(intervalMs = POLL_INTERVAL_MS): void {
    this.timer ??= setInterval(() => asPlatform("DOH rescans", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs queued checks, and resumes interrupted ones, until none remain. Returns how many were run. */
  async runPending(now: () => Date = () => new Date()): Promise<number> {
    let runs = 0;
    for (let row = await this.claim(now()); row; row = await this.claim(now())) {
      await this.run(row);
      runs++;
    }
    return runs;
  }

  // ---- internals -----------------------------------------------------------------------------

  /** Starts a requested check right away when the poller runs in this process (otherwise the next poll picks it up). */
  private kick(): void {
    if (this.timer) void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runPending();
    } catch (error) {
      this.logger.error(`Checking earlier diagnoses failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Claims the oldest queued or interrupted check (SKIP LOCKED: one runner per check across API instances). */
  private async claim(now: Date): Promise<RescanRecord | undefined> {
    return this.db.transaction(async (tx) => {
      for (;;) {
        const [row] = await tx
          .select()
          .from(dohRescan)
          .where(
            or(
              eq(dohRescan.status, "queued"),
              and(eq(dohRescan.status, "running"), or(isNull(dohRescan.heartbeatAt), lt(dohRescan.heartbeatAt, new Date(now.getTime() - STALE_AFTER_MS)))),
            ),
          )
          .orderBy(dohRescan.requestedAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return undefined;
        if (row.attempts >= RESCAN_MAX_ATTEMPTS) {
          await this.fail(tx, row, row.lastError ?? "Interrupted too many times");
          continue;
        }
        const [claimed] = (await tx
          .update(dohRescan)
          .set({ status: "running", attempts: row.attempts + 1, startedAt: row.startedAt ?? now, heartbeatAt: now })
          .where(eq(dohRescan.id, row.id))
          .returning()) as [RescanRecord];
        return claimed;
      }
    });
  }

  private async run(row: RescanRecord): Promise<void> {
    const organizationId = row.organizationId;
    try {
      // The rules active when the check runs.
      const rules = await this.settings.rules(organizationId, true);
      const range = { start: localDayBounds(row.fromDate, row.timeZone).start, end: localDayBounds(row.toDate, row.timeZone).end };
      let cursor = row.cursorRecordedAt && row.cursorDiagnosisId ? { recordedAt: row.cursorRecordedAt, diagnosisId: row.cursorDiagnosisId } : null;
      for (;;) {
        const page = await this.sources.codedDiagnosesRecorded(organizationId, range, cursor, PAGE_SIZE);
        let matched = 0;
        for (const diagnosis of page) {
          if (!isIcd10(diagnosis.codeSystemKey) || !matchRule(rules, diagnosis.code)) continue;
          matched++;
          await this.reports.detect(organizationId, diagnosis.id, { rules, rescanId: row.id });
        }
        const last = page.at(-1);
        if (last) cursor = { recordedAt: last.recordedAt, diagnosisId: last.id };
        await this.db
          .update(dohRescan)
          .set({
            scanned: sql`${dohRescan.scanned} + ${page.length}`,
            matched: sql`${dohRescan.matched} + ${matched}`,
            opened: this.openedCount(row.id),
            cursorRecordedAt: cursor?.recordedAt ?? null,
            cursorDiagnosisId: cursor?.diagnosisId ?? null,
            heartbeatAt: new Date(),
          })
          .where(and(eq(dohRescan.id, row.id), eq(dohRescan.status, "running")));
        if (page.length < PAGE_SIZE) break;
      }
      await this.db.transaction(async (tx) => {
        const [done] = (await tx
          .update(dohRescan)
          .set({ status: "completed", opened: this.openedCount(row.id), lastError: null, completedAt: new Date() })
          .where(and(eq(dohRescan.id, row.id), eq(dohRescan.status, "running")))
          .returning()) as RescanRecord[];
        if (!done) return;
        await this.audit.record(tx, systemActor(organizationId, null, "doh-reporting"), {
          action: "doh.rescan.completed",
          resourceType: "doh_rescan",
          resourceId: done.id,
          metadata: { from: done.fromDate, to: done.toDate, scanned: done.scanned, matched: done.matched, opened: done.opened },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Check of earlier diagnoses ${row.id} (attempt ${row.attempts}) failed: ${message}`);
      await this.db.transaction(async (tx) => {
        if (row.attempts >= RESCAN_MAX_ATTEMPTS) return this.fail(tx, row, message);
        // Left running: it is resumed from its cursor once its heartbeat is stale (a natural back-off).
        await tx
          .update(dohRescan)
          .set({ lastError: message.slice(0, 2000), heartbeatAt: new Date() })
          .where(and(eq(dohRescan.id, row.id), eq(dohRescan.status, "running")));
      });
    }
  }

  private async fail(tx: DbExecutor, row: RescanRecord, message: string): Promise<void> {
    const [failed] = (await tx
      .update(dohRescan)
      .set({ status: "failed", opened: this.openedCount(row.id), lastError: message.slice(0, 2000), completedAt: new Date() })
      .where(and(eq(dohRescan.id, row.id), inArray(dohRescan.status, ["queued", "running"])))
      .returning()) as RescanRecord[];
    if (!failed) return;
    await this.audit.record(tx, systemActor(row.organizationId, null, "doh-reporting"), {
      action: "doh.rescan.failed",
      resourceType: "doh_rescan",
      resourceId: row.id,
      outcome: "failure",
      metadata: { scanned: failed.scanned, matched: failed.matched, opened: failed.opened },
    });
  }

  /** Case reports this check opened (counted from the reports themselves, so a resumed check counts each once). */
  private openedCount(rescanId: string) {
    return sql<number>`(SELECT count(*)::int FROM ${dohCaseReport} WHERE ${dohCaseReport.rescanId} = ${rescanId})`;
  }
}

function view(row: RescanRecord) {
  const { organizationId: _o, cursorRecordedAt: _c, cursorDiagnosisId: _d, heartbeatAt: _h, attempts: _a, ...rest } = row;
  return rest;
}
