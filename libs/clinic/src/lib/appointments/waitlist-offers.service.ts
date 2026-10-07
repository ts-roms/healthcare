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
  DomainEventPublisher,
  filedAsPatient,
  localDate,
  systemActor,
} from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { facility, OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { practitioner, visitType, waitlistEntry, waitlistOffer, type WaitlistOfferRecord } from "../clinic.schema";
import { found } from "../clinic-support";
import { BookingRulesService } from "../config/booking-rules.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import { type BookingRules, offerable, offerCandidates, offerExpiry } from "../domain/patient-booking";
import { AppointmentService } from "./appointment.service";
import { type PatientBookingContext, PatientBookingService } from "./patient-booking.service";

const HOUR_MS = 3_600_000;

/** A time that opened and may be offered: the exact slot, and who freed it (never offered back to them). */
export interface OpenedSlot {
  startsAt: Date;
  endsAt: Date;
  practitionerId: string;
  visitTypeId: string | null;
  freedByPatientId: string | null;
}

export interface WaitlistOfferView {
  id: string;
  facilityId: string;
  entryId: string;
  patientId: string;
  patient: { patientNumber: string; displayName: string } | null;
  practitionerId: string;
  visitTypeId: string;
  startsAt: string;
  endsAt: string;
  offeredFor: string;
  expiresAt: string;
  status: WaitlistOfferRecord["status"];
  appointmentId: string | null;
  acceptedByPatient: boolean;
  withdrawReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

/** An offer as the patient sees it in MyHealth. */
export interface PatientOfferView {
  id: string;
  facilityId: string;
  facilityName: string;
  timeZone: string;
  visitTypeId: string;
  visitTypeName: string;
  practitionerId: string;
  practitionerName: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
}

/** "2 hours", "45 minutes", "1 day" for the notice. */
function holdText(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} minutes`;
}

/**
 * Offers from the waiting list (docs/domains/clinic.md, migration 0096). Where a facility chooses the `offer` mode, a
 * time that opens is held for the first matching patient-made entries (urgent first, then oldest; `offerBatch` at
 * once) for `offerHoldMinutes`. The patient accepts it in MyHealth, or staff accept it for them after speaking to
 * them; acceptance books through the ordinary booking commands, so lead time, limits and the exclusion constraints
 * apply and the first acceptance wins. An offer not accepted in time expires and the time goes to the next entries.
 * Nothing is ever booked without someone's acceptance.
 */
@Injectable()
export class WaitlistOffersService implements OnApplicationShutdown {
  private readonly logger = new Logger(WaitlistOffersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly notifications: NotificationService,
    private readonly organizations: OrganizationService,
    private readonly rules: BookingRulesService,
    private readonly appointments: AppointmentService,
    private readonly booking: PatientBookingService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  // ---- making offers ----------------------------------------------------------------------------------------------

  /**
   * Offers an opened time to the next waiting entries at the facility. Returns how many offers were made. Called when
   * an appointment is cancelled or moved (through the notices handler) and when an offer expires.
   */
  async offerSlot(organizationId: string, facilityId: string, opened: OpenedSlot, now = new Date()): Promise<number> {
    const site = await this.organizations.getFacility(organizationId, facilityId);
    const rules = await this.rules.forFacility(organizationId, facilityId);
    if (rules.waitlistMode !== "offer" || !rules.waitlistEnabled) return 0;
    if (!offerable(now, opened.startsAt, rules)) return 0;
    const date = localDate(opened.startsAt, site.timezone);
    const entries = await this.db
      .select()
      .from(waitlistEntry)
      .where(
        and(
          eq(waitlistEntry.organizationId, organizationId),
          eq(waitlistEntry.facilityId, facilityId),
          eq(waitlistEntry.status, "waiting"),
          eq(waitlistEntry.createdByPatient, true),
          lte(waitlistEntry.earliestDate, date),
          gte(waitlistEntry.latestDate, date),
        ),
      );
    if (!entries.length) return 0;
    const offered = await this.db
      .select({ entryId: waitlistOffer.entryId })
      .from(waitlistOffer)
      .where(
        and(
          eq(waitlistOffer.organizationId, organizationId),
          inArray(
            waitlistOffer.entryId,
            entries.map((e) => e.id),
          ),
          eq(waitlistOffer.offeredFor, date),
        ),
      );
    const candidates = offerCandidates(
      entries,
      { date, practitionerId: opened.practitionerId, visitTypeId: opened.visitTypeId, freedByPatientId: opened.freedByPatientId },
      new Set(offered.map((o) => o.entryId)),
      rules.offerBatch,
    );
    let made = 0;
    for (const entry of candidates) {
      const visitTypeId = entry.visitTypeId ?? opened.visitTypeId;
      if (!visitTypeId) continue;
      const expiresAt = offerExpiry(now, opened.startsAt, rules);
      const offer = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(waitlistOffer)
          .values({
            organizationId,
            facilityId,
            entryId: entry.id,
            patientId: entry.patientId,
            practitionerId: opened.practitionerId,
            visitTypeId,
            startsAt: opened.startsAt,
            endsAt: opened.endsAt,
            offeredFor: date,
            expiresAt,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) return null;
        await this.events.record(tx, {
          type: "WaitlistOfferMade",
          organizationId,
          aggregateType: "waitlist_offer",
          aggregateId: row.id,
          facilityId,
          patientId: row.patientId,
          payload: { offerId: row.id, entryId: entry.id, startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString() },
        });
        return row;
      });
      if (!offer) continue;
      made += 1;
      await this.notify(organizationId, facilityId, offer, site, rules);
    }
    return made;
  }

  private async notify(organizationId: string, facilityId: string, offer: WaitlistOfferRecord, site: { name: string; timezone: string }, rules: BookingRules) {
    const actor = systemActor(organizationId, facilityId, "waitlist-offer");
    const send = (channel: "sms" | "email") =>
      this.notifications.send(actor, {
        recipient: { type: "patient", patientId: offer.patientId },
        channel,
        templateKey: "appointment.waitlist-offer",
        variables: {
          facilityName: site.name.slice(0, 80),
          date: new Intl.DateTimeFormat("en-PH", { timeZone: site.timezone, dateStyle: "medium" }).format(offer.startsAt),
          holdText: holdText(rules.offerHoldMinutes),
        },
        idempotencyKey: `waitlist-offer:${offer.id}:${channel}`,
      });
    const sms = await send("sms");
    if (sms.status === "suppressed") await send("email");
  }

  // ---- reading ------------------------------------------------------------------------------------------------------

  /** The facility's offers (open ones, or all when asked), newest first, with the patient's name. */
  async listForStaff(actor: Actor, facilityId: string, includeClosed = false): Promise<WaitlistOfferView[]> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    const rows = await this.db
      .select()
      .from(waitlistOffer)
      .where(
        and(
          eq(waitlistOffer.organizationId, actor.organizationId),
          eq(waitlistOffer.facilityId, facilityId),
          includeClosed ? undefined : eq(waitlistOffer.status, "offered"),
        ),
      )
      .orderBy(desc(waitlistOffer.createdAt))
      .limit(200);
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]);
    if (rows.length) {
      await this.audit.recordStandalone(actor, {
        action: "waitlist.offers.view",
        resourceType: "waitlist_offer",
        metadata: { facilityId, count: rows.length },
      });
    }
    return rows.map((r) => ({ ...view(r), patient: patients.get(r.patientId) ?? null }));
  }

  /** The patient's open offers (not yet expired), soonest first, with names the patient needs to decide. */
  async listForPatient(ctx: PatientBookingContext, now = new Date()): Promise<PatientOfferView[]> {
    const rows = await this.db
      .select({
        offer: waitlistOffer,
        facilityName: facility.name,
        timeZone: facility.timezone,
        visitTypeName: visitType.name,
        practitionerName: practitioner.displayName,
      })
      .from(waitlistOffer)
      .innerJoin(facility, eq(facility.id, waitlistOffer.facilityId))
      .innerJoin(visitType, eq(visitType.id, waitlistOffer.visitTypeId))
      .innerJoin(practitioner, eq(practitioner.id, waitlistOffer.practitionerId))
      .where(
        and(
          eq(waitlistOffer.organizationId, ctx.organizationId),
          filedAsPatient(waitlistOffer.patientId, ctx.patientId),
          eq(waitlistOffer.status, "offered"),
          gte(waitlistOffer.expiresAt, now),
        ),
      )
      .orderBy(asc(waitlistOffer.startsAt));
    return rows.map((r) => ({
      id: r.offer.id,
      facilityId: r.offer.facilityId,
      facilityName: r.facilityName,
      timeZone: r.timeZone,
      visitTypeId: r.offer.visitTypeId,
      visitTypeName: r.visitTypeName,
      practitionerId: r.offer.practitionerId,
      practitionerName: r.practitionerName,
      startsAt: r.offer.startsAt.toISOString(),
      endsAt: r.offer.endsAt.toISOString(),
      expiresAt: r.offer.expiresAt.toISOString(),
    }));
  }

  // ---- deciding -----------------------------------------------------------------------------------------------------

  /** The patient accepts: the time is booked through the ordinary patient booking (lead time, limits, constraints). */
  async acceptByPatient(ctx: PatientBookingContext, offerId: string, now = new Date()) {
    const offer = await this.openOffer(ctx.organizationId, offerId, { patientId: ctx.patientId }, now);
    let booked;
    try {
      booked = await this.booking.book(
        ctx,
        { facilityId: offer.facilityId, visitTypeId: offer.visitTypeId, practitionerId: offer.practitionerId, startsAt: offer.startsAt.toISOString() },
        now,
      );
    } catch (error) {
      await this.markTakenIfGone(offer, error);
      throw error;
    }
    await this.close(offer.id, { status: "accepted", appointmentId: booked.id, acceptedByPatient: true }, async (tx) => {
      await this.audit.record(tx, ctx.audit, {
        action: "waitlist.offer.accept",
        resourceType: "waitlist_offer",
        resourceId: offer.id,
        patientId: offer.patientId,
        metadata: { via: "patient_portal", appointmentId: booked.id },
      });
      await this.events.record(tx, {
        type: "WaitlistOfferAccepted",
        organizationId: ctx.organizationId,
        aggregateType: "waitlist_offer",
        aggregateId: offer.id,
        facilityId: offer.facilityId,
        patientId: offer.patientId,
        payload: { offerId: offer.id, appointmentId: booked.id, byPatient: true },
      });
    });
    await this.markSiblingsTaken(offer);
    return booked;
  }

  /** Staff accept an offer for the patient (after speaking to them): booked at the front desk, the entry closed as booked. */
  async acceptByStaff(actor: Actor, offerId: string, now = new Date()) {
    const offer = await this.openOffer(actor.organizationId, offerId, {}, now);
    let booked;
    try {
      [booked] = await this.appointments.book(actor, {
        patientId: offer.patientId,
        practitionerId: offer.practitionerId,
        facilityId: offer.facilityId,
        visitTypeId: offer.visitTypeId,
        startsAt: offer.startsAt.toISOString(),
        bookingChannel: "front_desk",
        outsideSchedule: false,
        waitlistEntryId: offer.entryId,
      });
    } catch (error) {
      await this.markTakenIfGone(offer, error);
      throw error;
    }
    const appointmentId = booked!.id;
    await this.close(offer.id, { status: "accepted", appointmentId, acceptedBy: actor.userId }, async (tx) => {
      await this.audit.record(tx, actor, {
        action: "waitlist.offer.accept",
        resourceType: "waitlist_offer",
        resourceId: offer.id,
        patientId: offer.patientId,
        metadata: { appointmentId },
      });
      await this.events.record(tx, {
        type: "WaitlistOfferAccepted",
        organizationId: actor.organizationId,
        aggregateType: "waitlist_offer",
        aggregateId: offer.id,
        facilityId: offer.facilityId,
        patientId: offer.patientId,
        payload: { offerId: offer.id, appointmentId, byPatient: false },
      });
    });
    await this.markSiblingsTaken(offer);
    return booked!;
  }

  /** The patient declines: the entry stays on the list; the time goes to the next entries at once. */
  async declineByPatient(ctx: PatientBookingContext, offerId: string, now = new Date()): Promise<void> {
    const offer = await this.openOffer(ctx.organizationId, offerId, { patientId: ctx.patientId }, now);
    await this.close(offer.id, { status: "declined" }, async (tx) => {
      await this.audit.record(tx, ctx.audit, {
        action: "waitlist.offer.decline",
        resourceType: "waitlist_offer",
        resourceId: offer.id,
        patientId: offer.patientId,
        metadata: { via: "patient_portal" },
      });
    });
    await this.reoffer(offer, now);
  }

  /** Staff withdraw an offer with a reason (the patient no longer needs it, the time is kept for someone else…). */
  async withdraw(actor: Actor, offerId: string, reason: string, now = new Date()): Promise<WaitlistOfferView> {
    const offer = await this.openOffer(actor.organizationId, offerId, {}, now);
    const closed = await this.close(offer.id, { status: "withdrawn", withdrawnBy: actor.userId, withdrawReason: reason }, async (tx) => {
      await this.audit.record(tx, actor, {
        action: "waitlist.offer.withdraw",
        resourceType: "waitlist_offer",
        resourceId: offer.id,
        patientId: offer.patientId,
        reason,
      });
    });
    return { ...view(closed), patient: null };
  }

  // ---- expiry (hourly) ------------------------------------------------------------------------------------------------

  start(intervalMs = HOUR_MS): void {
    this.timer ??= setInterval(() => asPlatform("waiting-list offers", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.expire();
    } catch (error) {
      this.logger.error(`Waiting-list offer expiry failed: ${String(error)}`);
    }
  }

  /** Expires offers whose hold ran out and hands each time on to the next entries. Returns how many expired. */
  async expire(now = new Date()): Promise<{ expired: number }> {
    const due = await this.db
      .select()
      .from(waitlistOffer)
      .where(and(eq(waitlistOffer.status, "offered"), lte(waitlistOffer.expiresAt, now)))
      .orderBy(asc(waitlistOffer.expiresAt))
      .limit(500);
    let expired = 0;
    for (const offer of due) {
      const closed = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(waitlistOffer)
          .set({ status: "expired", closedAt: now })
          .where(and(eq(waitlistOffer.id, offer.id), eq(waitlistOffer.status, "offered")))
          .returning();
        if (!row) return null;
        await this.events.record(tx, {
          type: "WaitlistOfferExpired",
          organizationId: row.organizationId,
          aggregateType: "waitlist_offer",
          aggregateId: row.id,
          facilityId: row.facilityId,
          patientId: row.patientId,
          payload: { offerId: row.id, entryId: row.entryId },
        });
        return row;
      });
      if (!closed) continue;
      expired += 1;
      await this.reoffer(closed, now);
    }
    return { expired };
  }

  // ---- internals ----------------------------------------------------------------------------------------------------

  /** An offer that is still open for this patient (or for staff); an expired one is closed on the way. */
  private async openOffer(organizationId: string, offerId: string, scope: { patientId?: string }, now: Date): Promise<WaitlistOfferRecord> {
    const [row] = await this.db
      .select()
      .from(waitlistOffer)
      .where(
        and(
          eq(waitlistOffer.organizationId, organizationId),
          eq(waitlistOffer.id, offerId),
          scope.patientId ? filedAsPatient(waitlistOffer.patientId, scope.patientId) : undefined,
        ),
      );
    const offer = found(row, "Offer");
    if (offer.status !== "offered") throw new BusinessRuleError(`This offer is ${offer.status}`, `offer_${offer.status}`);
    if (offer.expiresAt.getTime() <= now.getTime()) {
      await this.close(offer.id, { status: "expired" }, async () => undefined, now);
      throw new BusinessRuleError("The time is no longer held — it may have gone to someone else", "offer_expired");
    }
    return offer;
  }

  private async close(
    offerId: string,
    changes: Partial<typeof waitlistOffer.$inferInsert>,
    also: (tx: DbExecutor) => Promise<void>,
    now = new Date(),
  ): Promise<WaitlistOfferRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(waitlistOffer)
        .set({ ...changes, closedAt: now })
        .where(and(eq(waitlistOffer.id, offerId), eq(waitlistOffer.status, "offered")))
        .returning();
      if (!row) throw new ConflictError("The offer was just closed by someone else", undefined, "offer_closed");
      await also(tx);
      return row;
    });
  }

  /** A booking refused because the time went to someone else marks the offer taken; any other refusal leaves it open. */
  private async markTakenIfGone(offer: WaitlistOfferRecord, error: unknown): Promise<void> {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "slot_unavailable") return;
    await this.close(offer.id, { status: "taken" }, async () => undefined).catch(() => undefined);
  }

  /** Other open offers of the same time, once one is accepted, are taken. */
  private async markSiblingsTaken(accepted: WaitlistOfferRecord): Promise<void> {
    await this.db
      .update(waitlistOffer)
      .set({ status: "taken", closedAt: new Date() })
      .where(
        and(
          eq(waitlistOffer.organizationId, accepted.organizationId),
          eq(waitlistOffer.practitionerId, accepted.practitionerId),
          eq(waitlistOffer.startsAt, accepted.startsAt),
          eq(waitlistOffer.status, "offered"),
        ),
      );
  }

  /** Hands a declined or expired time to the next entries, while it is still free and worth offering. */
  private async reoffer(offer: WaitlistOfferRecord, now: Date): Promise<void> {
    const taken = await this.appointments.bookedIntervals(this.db, offer.practitionerId, offer.startsAt, offer.endsAt);
    if (taken.length) return;
    await this.offerSlot(
      offer.organizationId,
      offer.facilityId,
      { startsAt: offer.startsAt, endsAt: offer.endsAt, practitionerId: offer.practitionerId, visitTypeId: offer.visitTypeId, freedByPatientId: null },
      now,
    ).catch((error: unknown) => this.logger.error(`Re-offering a time failed: ${String(error)}`));
  }
}

function view(r: WaitlistOfferRecord): Omit<WaitlistOfferView, "patient"> {
  return {
    id: r.id,
    facilityId: r.facilityId,
    entryId: r.entryId,
    patientId: r.patientId,
    practitionerId: r.practitionerId,
    visitTypeId: r.visitTypeId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    offeredFor: r.offeredFor,
    expiresAt: r.expiresAt.toISOString(),
    status: r.status,
    appointmentId: r.appointmentId,
    acceptedByPatient: r.acceptedByPatient,
    withdrawReason: r.withdrawReason,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}
