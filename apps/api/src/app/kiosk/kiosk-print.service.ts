import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { ClinicQueries } from "@healthcare/clinic";
import { type Actor, asPlatform, BusinessRuleError, DATABASE, type Database, NotFoundError, requireFacilityId } from "@healthcare/core";
import { and, asc, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { claimPrintSchema, printerHeartbeatSchema, printResultSchema, reprintSchema } from "./kiosk.dto";
import { MAX_REPRINTS, PRINT_JOB_MAX_AGE_MS, PRINT_LEASE_MS, PRINT_MAX_ATTEMPTS } from "./kiosk.rules";
import { kioskDevice, kioskPrintJob, type KioskPrintJobRecord, type KioskPrintStatus } from "./kiosk.schema";
import { found } from "./kiosk-support";

/** What the print agent receives: exactly what is printed, nothing about the patient. */
export interface AgentPrintJob {
  id: string;
  attempt: number;
  ticket: string;
  serviceName: string;
  facilityName: string;
  issuedAt: Date;
  instructions: string;
}

/** What a kiosk may learn about its own ticket's printing. */
export interface KioskPrintStatusView {
  status: KioskPrintStatus;
  attempts: number;
  error: string | null;
}

/** What staff see in the list of tickets: no patient, no visit. */
export interface PrintJobView {
  id: string;
  device: string;
  ticket: string;
  serviceName: string;
  status: KioskPrintStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  printedAt: Date | null;
  reprint: boolean;
  /** Whether it can be printed again now (finished, within the reprint limit). */
  canReprint: boolean;
}

const toAgentJob = (row: KioskPrintJobRecord): AgentPrintJob => ({
  id: row.id,
  attempt: row.attempts,
  ticket: row.ticket,
  serviceName: row.serviceName,
  facilityName: row.facilityName,
  issuedAt: row.issuedAt,
  instructions: row.instructions,
});

/**
 * Printing a kiosk's ticket (docs/domains/kiosk.md, "Printing and devices"). The check-in queues one job per visit
 * (never a second for the same visit); a local print agent signed in as its own restricted account claims jobs for one kiosk
 * at a time under a short lease, prints them and reports back, and a job nobody prints within ten minutes is dropped. The
 * agent only pulls: nothing here calls into the clinic's network.
 */
@Injectable()
export class KioskPrintService {
  private readonly logger = new Logger(KioskPrintService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly clinic: ClinicQueries,
  ) {}

  // ---- Queued by the check-in -----------------------------------------------------------------------------------------

  /**
   * Queues the ticket for the kiosk's printer; null when the kiosk has no printer or the job could not be queued (the screen
   * still shows the ticket: printing never stands in the way of a check-in). A repeat for the same visit returns the job
   * already queued.
   */
  async enqueueTicket(
    device: { id: string; organizationId: string; facilityId: string; printerStatus: string },
    ticket: { visitId: string; ticket: string; serviceName: string; facilityName: string; issuedAt: Date; instructions: string },
  ): Promise<string | null> {
    if (device.printerStatus === "none") return null;
    try {
      const [created] = await this.db
        .insert(kioskPrintJob)
        .values({
          organizationId: device.organizationId,
          facilityId: device.facilityId,
          deviceId: device.id,
          visitId: ticket.visitId,
          ticket: ticket.ticket,
          serviceName: ticket.serviceName.slice(0, 100),
          facilityName: ticket.facilityName.slice(0, 200),
          issuedAt: ticket.issuedAt,
          instructions: ticket.instructions.slice(0, 300),
        })
        .onConflictDoNothing({ target: kioskPrintJob.visitId, where: isNull(kioskPrintJob.reprintOf) })
        .returning({ id: kioskPrintJob.id });
      if (created) return created.id;
      const [existing] = await this.db
        .select({ id: kioskPrintJob.id })
        .from(kioskPrintJob)
        .where(and(eq(kioskPrintJob.visitId, ticket.visitId), isNull(kioskPrintJob.reprintOf)));
      return existing?.id ?? null;
    } catch (error) {
      this.logger.error({ event: "kiosk.print_enqueue_failed", error: String(error) });
      return null;
    }
  }

  /** How printing is going for a ticket this kiosk's own check-in queued. */
  async statusForKiosk(organizationId: string, deviceId: string, jobId: string): Promise<KioskPrintStatusView> {
    const [row] = await this.db
      .select()
      .from(kioskPrintJob)
      .where(and(eq(kioskPrintJob.organizationId, organizationId), eq(kioskPrintJob.id, jobId), eq(kioskPrintJob.deviceId, deviceId)));
    if (!row) throw new NotFoundError("Ticket");
    return { status: row.status, attempts: row.attempts, error: row.lastError };
  }

  // ---- The print agent --------------------------------------------------------------------------------------------------

  /** The kiosk the agent says it drives, at the agent's facility; anything else is not found. */
  private async deviceByCode(actor: Actor, code: string) {
    const facilityId = requireFacilityId(actor);
    const [device] = await this.db
      .select()
      .from(kioskDevice)
      .where(
        and(
          eq(kioskDevice.organizationId, actor.organizationId),
          eq(kioskDevice.facilityId, facilityId),
          eq(kioskDevice.code, code),
          eq(kioskDevice.kind, "kiosk"),
        ),
      );
    if (!device) throw new NotFoundError("Kiosk");
    return device;
  }

  /**
   * The next ticket to print for one kiosk, held for the agent under a lease. A job whose lease ran out (the agent died
   * mid-print) is offered again; one tried `PRINT_MAX_ATTEMPTS` times fails instead. Null when nothing is waiting.
   */
  async claim(actor: Actor, input: z.infer<typeof claimPrintSchema>): Promise<AgentPrintJob | null> {
    const device = await this.deviceByCode(actor, input.deviceCode);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      for (let i = 0; i < 5; i++) {
        const [job] = await tx
          .select()
          .from(kioskPrintJob)
          .where(
            and(
              eq(kioskPrintJob.organizationId, actor.organizationId),
              eq(kioskPrintJob.deviceId, device.id),
              gt(kioskPrintJob.createdAt, new Date(now.getTime() - PRINT_JOB_MAX_AGE_MS)),
              or(eq(kioskPrintJob.status, "queued"), and(eq(kioskPrintJob.status, "printing"), lt(kioskPrintJob.leaseExpiresAt, now))),
            ),
          )
          .orderBy(asc(kioskPrintJob.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!job) return null;
        if (job.attempts >= PRINT_MAX_ATTEMPTS) {
          await tx
            .update(kioskPrintJob)
            .set({ status: "failed", lastError: "attempts_exhausted", leaseExpiresAt: null, updatedAt: now })
            .where(eq(kioskPrintJob.id, job.id));
          continue;
        }
        const [claimed] = await tx
          .update(kioskPrintJob)
          .set({ status: "printing", attempts: job.attempts + 1, leaseExpiresAt: new Date(now.getTime() + PRINT_LEASE_MS), updatedAt: now })
          .where(eq(kioskPrintJob.id, job.id))
          .returning();
        return toAgentJob(found(claimed, "Print job"));
      }
      return null;
    });
  }

  /** What the agent says happened to a ticket it claimed. A repeat of the same answer is accepted and changes nothing. */
  async report(actor: Actor, jobId: string, input: z.infer<typeof printResultSchema>): Promise<{ status: KioskPrintStatus }> {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(kioskPrintJob)
        .where(and(eq(kioskPrintJob.organizationId, actor.organizationId), eq(kioskPrintJob.id, jobId), eq(kioskPrintJob.facilityId, facilityId)))
        .for("update");
      if (!job) throw new NotFoundError("Print job");
      if (input.outcome === "printed" && job.status === "printed") return { status: "printed" };
      if (job.status !== "printing") throw new BusinessRuleError("This ticket is not being printed", "print_job_not_active");

      const now = new Date();
      let status: KioskPrintStatus;
      if (input.outcome === "printed") status = "printed";
      else status = input.retry && job.attempts < PRINT_MAX_ATTEMPTS ? "queued" : "failed";
      await tx
        .update(kioskPrintJob)
        .set({
          status,
          leaseExpiresAt: null,
          lastError: input.outcome === "printed" ? null : (input.error ?? "error"),
          printedAt: status === "printed" ? now : null,
          updatedAt: now,
        })
        .where(eq(kioskPrintJob.id, jobId));
      // The printer's state follows what happened: a printed ticket means it works, a failure says what is wrong.
      await tx
        .update(kioskDevice)
        .set({ printerStatus: input.outcome === "printed" ? "ok" : (input.error ?? "error"), printerHeartbeatAt: now })
        .where(eq(kioskDevice.id, job.deviceId));
      if (status === "failed") {
        await this.audit.record(tx, actor, {
          action: "kiosk.print.failed",
          resourceType: "kiosk_print_job",
          resourceId: jobId,
          metadata: { ticket: job.ticket, error: input.error ?? "error", attempts: job.attempts },
        });
      }
      return { status };
    });
  }

  /** The agent's regular report of the printer it drives (paper, connection): what staff see as printer availability. */
  async printerHeartbeat(actor: Actor, input: z.infer<typeof printerHeartbeatSchema>): Promise<{ ok: true }> {
    const device = await this.deviceByCode(actor, input.deviceCode);
    await this.db.update(kioskDevice).set({ printerStatus: input.printerStatus, printerHeartbeatAt: new Date() }).where(eq(kioskDevice.id, device.id));
    return { ok: true };
  }

  // ---- Staff ----------------------------------------------------------------------------------------------------------------

  /** The facility's tickets of the last 24 hours, newest first: how each print went, and which can be printed again. */
  async list(actor: Actor, status?: KioskPrintStatus): Promise<PrintJobView[]> {
    const facilityId = requireFacilityId(actor);
    const since = new Date(Date.now() - 24 * 3_600_000);
    const rows = await this.db
      .select({ job: kioskPrintJob, device: kioskDevice.name })
      .from(kioskPrintJob)
      .innerJoin(kioskDevice, and(eq(kioskDevice.organizationId, kioskPrintJob.organizationId), eq(kioskDevice.id, kioskPrintJob.deviceId)))
      .where(
        and(
          eq(kioskPrintJob.organizationId, actor.organizationId),
          eq(kioskPrintJob.facilityId, facilityId),
          gt(kioskPrintJob.createdAt, since),
          ...(status ? [eq(kioskPrintJob.status, status)] : []),
        ),
      )
      .orderBy(desc(kioskPrintJob.createdAt))
      .limit(200);
    const reprints = await this.db
      .select({ root: kioskPrintJob.reprintOf, n: count() })
      .from(kioskPrintJob)
      .where(and(eq(kioskPrintJob.organizationId, actor.organizationId), eq(kioskPrintJob.facilityId, facilityId), gt(kioskPrintJob.createdAt, since)))
      .groupBy(kioskPrintJob.reprintOf);
    const used = new Map(reprints.flatMap((r) => (r.root ? [[r.root, r.n] as const] : [])));
    return rows.map(({ job, device }) => {
      const root = job.reprintOf ?? job.id;
      return {
        id: job.id,
        device,
        ticket: job.ticket,
        serviceName: job.serviceName,
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
        createdAt: job.createdAt,
        printedAt: job.printedAt,
        reprint: job.reprintOf !== null,
        canReprint: (job.status === "printed" || job.status === "failed") && (used.get(root) ?? 0) < MAX_REPRINTS,
      };
    });
  }

  /**
   * Prints a ticket again, at a staff member's request and with a reason: for a patient who lost it or whose print failed.
   * A ticket can be printed again `MAX_REPRINTS` times, only while its visit is open and its kiosk is in service, and
   * never while the earlier print is still going. The reprint is a new job pointing at the original; audited.
   */
  async reprint(actor: Actor, jobId: string, input: z.infer<typeof reprintSchema>): Promise<PrintJobView> {
    const facilityId = requireFacilityId(actor);
    const [first] = await this.db
      .select()
      .from(kioskPrintJob)
      .where(and(eq(kioskPrintJob.organizationId, actor.organizationId), eq(kioskPrintJob.id, jobId), eq(kioskPrintJob.facilityId, facilityId)));
    if (!first) throw new NotFoundError("Print job");
    const rootId = first.reprintOf ?? first.id;

    return this.db.transaction(async (tx) => {
      // The original is locked, so two reprints of one ticket count one after the other.
      const [root] = await tx
        .select()
        .from(kioskPrintJob)
        .where(and(eq(kioskPrintJob.organizationId, actor.organizationId), eq(kioskPrintJob.id, rootId)))
        .for("update");
      const original = found(root, "Print job");
      const [current] = await tx
        .select()
        .from(kioskPrintJob)
        .where(and(eq(kioskPrintJob.organizationId, actor.organizationId), eq(kioskPrintJob.id, jobId)));
      if (!current || (current.status !== "printed" && current.status !== "failed")) {
        throw new BusinessRuleError("Wait until the earlier print has finished", "print_job_in_progress");
      }
      const [used] = await tx.select({ n: count() }).from(kioskPrintJob).where(eq(kioskPrintJob.reprintOf, rootId));
      if ((used?.n ?? 0) >= MAX_REPRINTS) {
        throw new BusinessRuleError(`A ticket can be printed again ${MAX_REPRINTS} times`, "reprint_limit_reached");
      }
      if (!(await this.clinic.visitIsOpen(actor.organizationId, original.visitId))) {
        throw new BusinessRuleError("This ticket is no longer in the queue", "ticket_no_longer_valid");
      }
      const [device] = await tx.select().from(kioskDevice).where(eq(kioskDevice.id, original.deviceId));
      if (!device || device.status !== "active") throw new BusinessRuleError("That kiosk is not in service", "kiosk_not_available");

      const [created] = await tx
        .insert(kioskPrintJob)
        .values({
          organizationId: original.organizationId,
          facilityId: original.facilityId,
          deviceId: original.deviceId,
          visitId: original.visitId,
          ticket: original.ticket,
          serviceName: original.serviceName,
          facilityName: original.facilityName,
          issuedAt: original.issuedAt,
          instructions: original.instructions,
          reprintOf: rootId,
          reprintReason: input.reason,
          requestedBy: actor.userId,
        })
        .returning();
      const job = found(created, "Print job");
      await this.audit.record(tx, actor, {
        action: "kiosk.print.reprint",
        resourceType: "kiosk_print_job",
        resourceId: job.id,
        reason: input.reason,
        metadata: { ticket: job.ticket, original: rootId, device: device.code },
      });
      return {
        id: job.id,
        device: device.name,
        ticket: job.ticket,
        serviceName: job.serviceName,
        status: job.status,
        attempts: job.attempts,
        lastError: null,
        createdAt: job.createdAt,
        printedAt: null,
        reprint: true,
        canReprint: false,
      };
    });
  }

  // ---- Housekeeping ---------------------------------------------------------------------------------------------------------

  /** Drops tickets nobody printed in time, and fails those whose attempts ran out under an expired lease. Idempotent. */
  async expireDue(now = new Date()): Promise<number> {
    return asPlatform("kiosk print expiry", async () => {
      const dropped = await this.db
        .update(kioskPrintJob)
        .set({ status: "cancelled", lastError: "expired", updatedAt: now })
        .where(and(eq(kioskPrintJob.status, "queued"), lt(kioskPrintJob.createdAt, new Date(now.getTime() - PRINT_JOB_MAX_AGE_MS))))
        .returning({ id: kioskPrintJob.id });
      const exhausted = await this.db
        .update(kioskPrintJob)
        .set({ status: "failed", lastError: "attempts_exhausted", leaseExpiresAt: null, updatedAt: now })
        .where(and(eq(kioskPrintJob.status, "printing"), lt(kioskPrintJob.leaseExpiresAt, now), sql`${kioskPrintJob.attempts} >= ${PRINT_MAX_ATTEMPTS}`))
        .returning({ id: kioskPrintJob.id });
      return dropped.length + exhausted.length;
    });
  }
}
