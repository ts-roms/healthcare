import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { VisitService } from "@healthcare/clinic";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  asPgError,
  asPlatform,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  integrationPayloadKeyring,
  type Keyring,
  openWithKeyring,
  PgErrorCode,
  requireFacilityId,
  sealWithKeyring,
} from "@healthcare/core";
import { PatientRecordService, PatientRegistrationService, type RegisterPatientInput } from "@healthcare/patient";
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { KioskDeviceService } from "./kiosk-device.service";
import { KioskSessionService } from "./kiosk-session.service";
import type { approveRegistrationSchema, KioskRegistrationInput, linkRegistrationSchema, rejectRegistrationSchema } from "./kiosk.dto";
import { newRegistrationReference, REGISTRATION_TTL_MS } from "./kiosk.rules";
import { kioskDevice, kioskRegistration, type KioskRegistrationRecord } from "./kiosk.schema";
import { found } from "./kiosk-support";

/** At most this many registrations may wait from one kiosk, so a flood of submissions cannot bury the desk. */
export const MAX_PENDING_PER_DEVICE = 50;
/** And at most this many in any hour, whether or not reception has answered: a kiosk used by hand cannot reach it, a script soon does. */
export const MAX_PER_DEVICE_PER_HOUR = 20;
/** A reviewer's claim on a registration they are deciding lapses after this long (the browser closed, the request died). */
export const CLAIM_MS = 2 * 60_000;

export interface PendingRegistrationView {
  id: string;
  reference: string;
  submittedAt: Date;
  expiresAt: Date;
  kiosk: string;
  /** Existing patients the Patient Master thought might be the same person, found when it was submitted. */
  possibleDuplicates: number;
}

const stripSession = (row: KioskRegistrationRecord) => ({ id: row.id, reference: row.reference, status: row.status });

/**
 * Registrations typed at a kiosk (docs/domains/kiosk.md). A new patient never becomes a patient on their own: the
 * submission waits, sealed, for a member of staff to check who they are, look at possible duplicates, and approve it
 * (the ordinary registration, with its duplicate rules), link it to an existing patient, or reject it. The sealed
 * payload is erased as soon as there is a decision, and after 24 hours if nobody decides.
 */
@Injectable()
export class KioskRegistrationService {
  private readonly keyring: Keyring;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly devices: KioskDeviceService,
    private readonly sessions: KioskSessionService,
    private readonly registration: PatientRegistrationService,
    private readonly records: PatientRecordService,
    private readonly visits: VisitService,
  ) {
    this.keyring = integrationPayloadKeyring(config);
  }

  // ---- The kiosk ----------------------------------------------------------------------------------------------

  /**
   * Stores what the person typed for staff to review. The answer is always the same short reference — it does not say
   * whether the person may already be a patient. Submitting again in the same session returns the same reference.
   */
  async submit(actor: Actor, token: string | undefined, input: KioskRegistrationInput): Promise<{ reference: string; expiresAt: Date }> {
    const session = await this.sessions.resolve(actor, token);
    if (session.patientId) throw new BusinessRuleError("You are already identified. Please check in instead.", "kiosk_already_identified");
    const device = await this.devices.requireDevice(actor, { serving: true });

    const [pending] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(kioskRegistration)
      .where(and(eq(kioskRegistration.deviceId, device.id), eq(kioskRegistration.status, "pending")));
    if ((pending?.n ?? 0) >= MAX_PENDING_PER_DEVICE) {
      throw new BusinessRuleError("Registration is not available at this kiosk right now — please see the front desk.", "kiosk_registration_backlog");
    }
    const [lastHour] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(kioskRegistration)
      .where(and(eq(kioskRegistration.deviceId, device.id), gt(kioskRegistration.submittedAt, new Date(Date.now() - 3_600_000))));
    if ((lastHour?.n ?? 0) >= MAX_PER_DEVICE_PER_HOUR) {
      throw new BusinessRuleError("Registration is not available at this kiosk right now — please see the front desk.", "kiosk_registration_busy");
    }

    const candidates = await this.registration.findDuplicates(this.db, actor.organizationId, {
      familyName: input.familyName,
      givenName: input.givenName,
      middleName: input.middleName,
      birthDate: input.birthDate,
      sex: input.sex,
      contacts: input.contacts,
      identifiers: input.identifiers,
    });
    const { keyId, sealed } = sealWithKeyring(JSON.stringify(input), this.keyring);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(kioskRegistration)
            .values({
              organizationId: actor.organizationId,
              facilityId: session.facilityId,
              deviceId: device.id,
              sessionId: session.id,
              reference: newRegistrationReference(),
              payloadSealed: sealed,
              payloadKeyId: keyId,
              duplicateCandidateIds: candidates.map((c) => c.patient.id),
              submittedAt: now,
              expiresAt,
            })
            .returning();
          const row = found(created, "Registration");
          await this.audit.record(tx, actor, {
            action: "kiosk.registration.submit",
            resourceType: "kiosk_registration",
            resourceId: row.id,
            metadata: { reference: row.reference, deviceId: device.id, possibleDuplicates: candidates.length },
          });
          await this.events.record(tx, {
            type: "KioskRegistrationSubmitted",
            organizationId: row.organizationId,
            aggregateType: "kiosk_registration",
            aggregateId: row.id,
            facilityId: row.facilityId,
            payload: { reference: row.reference },
          });
          return { reference: row.reference, expiresAt: row.expiresAt };
        });
      } catch (error) {
        const pg = asPgError(error);
        if (pg?.code !== PgErrorCode.uniqueViolation) throw error;
        if (pg.constraint === "kiosk_registration_session_uq") {
          const [existing] = await this.db.select().from(kioskRegistration).where(eq(kioskRegistration.sessionId, session.id));
          if (existing) return { reference: existing.reference, expiresAt: existing.expiresAt };
        }
        // Otherwise the reference collided with another: draw a new one.
      }
    }
    throw new BusinessRuleError("Please try again.", "kiosk_registration_retry");
  }

  // ---- Staff --------------------------------------------------------------------------------------------------

  /** Registrations waiting at the actor's facility, oldest first. No personal data: that is behind `get`. */
  async pending(actor: Actor): Promise<PendingRegistrationView[]> {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select({ r: kioskRegistration, kiosk: kioskDevice.name })
      .from(kioskRegistration)
      .innerJoin(kioskDevice, and(eq(kioskDevice.organizationId, kioskRegistration.organizationId), eq(kioskDevice.id, kioskRegistration.deviceId)))
      .where(
        and(eq(kioskRegistration.organizationId, actor.organizationId), eq(kioskRegistration.facilityId, facilityId), eq(kioskRegistration.status, "pending")),
      )
      .orderBy(asc(kioskRegistration.submittedAt));
    return rows.map(({ r, kiosk }) => ({
      id: r.id,
      reference: r.reference,
      submittedAt: r.submittedAt,
      expiresAt: r.expiresAt,
      kiosk,
      possibleDuplicates: r.duplicateCandidateIds.length,
    }));
  }

  /** How many registrations wait at the actor's facility (the navigation badge); null when no facility is selected. */
  async countPending(actor: Actor): Promise<number | null> {
    if (!actor.facilityId) return null;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(kioskRegistration)
      .where(
        and(
          eq(kioskRegistration.organizationId, actor.organizationId),
          eq(kioskRegistration.facilityId, actor.facilityId),
          eq(kioskRegistration.status, "pending"),
        ),
      );
    return row?.n ?? 0;
  }

  /** What the person typed, and who the Patient Master thinks they might be now. Audited as a view of personal data. */
  async get(actor: Actor, registrationId: string) {
    const row = await this.requirePending(this.db, actor, registrationId);
    const input = this.open(row);
    const candidates = await this.registration.findDuplicates(this.db, actor.organizationId, {
      familyName: input.familyName,
      givenName: input.givenName,
      middleName: input.middleName,
      birthDate: input.birthDate,
      sex: input.sex,
      contacts: input.contacts,
      identifiers: input.identifiers,
    });
    await this.audit.recordStandalone(actor, {
      action: "kiosk.registration.view",
      resourceType: "kiosk_registration",
      resourceId: row.id,
      metadata: { reference: row.reference, candidateIds: candidates.map((c) => c.patient.id) },
    });
    return {
      id: row.id,
      reference: row.reference,
      submittedAt: row.submittedAt,
      expiresAt: row.expiresAt,
      registration: input,
      possibleDuplicates: candidates,
    };
  }

  /**
   * Registers the person through the ordinary front-desk registration (so its duplicate rules apply unchanged: a
   * likely duplicate is refused unless the reviewer confirms the candidates and gives a reason), then closes the
   * submission. The queue entry, if asked for, is the usual staff walk-in.
   */
  async approve(actor: Actor, registrationId: string, input: z.infer<typeof approveRegistrationSchema>) {
    const row = await this.requirePending(this.db, actor, registrationId);
    if (input.visitTypeId) this.requireQueueRight(actor);
    const typed = this.open(row);
    // Only one reviewer decides a registration at a time; a failure before the patient exists releases it again.
    await this.claim(actor, row.id);
    let created: { id: string; patientNumber: string };
    try {
      const { emergencyContact, privacyAcknowledged: _acknowledged, ...person } = typed;
      created = await this.registration.register(actor, {
        ...person,
        relationships: [
          {
            relationship: emergencyContact.relationship,
            name: emergencyContact.name,
            contactNumber: emergencyContact.contactNumber,
            isEmergencyContact: true,
          },
        ],
        ...(input.duplicateOverride ? { duplicateOverride: input.duplicateOverride } : {}),
      } satisfies RegisterPatientInput);
    } catch (error) {
      await this.release(row.id);
      throw error;
    }
    // The patient exists now, so the submission is closed against them whatever happens next: a failure to queue them
    // is reported to the reviewer, never left as an unlinked patient with a still-pending submission.
    let visitId: string | null = null;
    let queueError: string | null = null;
    if (input.visitTypeId) {
      try {
        visitId = (await this.visits.walkIn(actor, { patientId: created.id, visitTypeId: input.visitTypeId, priority: "routine" })).id;
      } catch (error) {
        queueError = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "queue_failed";
      }
    }
    await this.decide(actor, row, "approved", { patientId: created.id, visitId, identityNote: input.identityNote });
    return {
      patientId: created.id,
      patientNumber: created.patientNumber,
      visitId,
      queued: visitId !== null,
      ...(queueError ? { queueError } : {}),
    };
  }

  /** The person is already a patient: the reviewer says which record, and the submission is closed without creating one. */
  async link(actor: Actor, registrationId: string, input: z.infer<typeof linkRegistrationSchema>) {
    const row = await this.requirePending(this.db, actor, registrationId);
    if (input.visitTypeId) this.requireQueueRight(actor);
    // Reading the record proves it exists in this organization and is audited as the reviewer's own access.
    const record = await this.records.getDetail(actor, input.patientId);
    await this.claim(actor, row.id);
    let visitId: string | null = null;
    try {
      if (input.visitTypeId) visitId = (await this.visits.walkIn(actor, { patientId: record.id, visitTypeId: input.visitTypeId, priority: "routine" })).id;
    } catch (error) {
      await this.release(row.id);
      throw error;
    }
    await this.decide(actor, row, "linked", { patientId: record.id, visitId, identityNote: input.identityNote });
    return { patientId: record.id, visitId };
  }

  async reject(actor: Actor, registrationId: string, input: z.infer<typeof rejectRegistrationSchema>) {
    const row = await this.requirePending(this.db, actor, registrationId);
    await this.decide(actor, row, "rejected", { reason: input.reason });
    return stripSession({ ...row, status: "rejected" });
  }

  /** Erases submissions nobody decided in time. */
  async expireDue(now = new Date()): Promise<number> {
    return asPlatform("kiosk registration expiry", async () => {
      const rows = await this.db
        .update(kioskRegistration)
        .set({ status: "expired", payloadSealed: null, payloadKeyId: null })
        .where(and(eq(kioskRegistration.status, "pending"), lt(kioskRegistration.expiresAt, now)))
        .returning({ id: kioskRegistration.id });
      return rows.length;
    });
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  /** Takes the registration for this reviewer; another reviewer's recent claim means it is being decided already. */
  private async claim(actor: Actor, id: string): Promise<void> {
    const now = new Date();
    const [claimed] = await this.db
      .update(kioskRegistration)
      .set({ claimedBy: actor.userId, claimedAt: now })
      .where(
        and(
          eq(kioskRegistration.id, id),
          eq(kioskRegistration.status, "pending"),
          or(isNull(kioskRegistration.claimedAt), lt(kioskRegistration.claimedAt, new Date(now.getTime() - CLAIM_MS))),
        ),
      )
      .returning({ id: kioskRegistration.id });
    if (!claimed) throw new BusinessRuleError("Someone else is deciding this registration", "registration_in_review");
  }

  private async release(id: string): Promise<void> {
    await this.db
      .update(kioskRegistration)
      .set({ claimedBy: null, claimedAt: null })
      .where(and(eq(kioskRegistration.id, id), eq(kioskRegistration.status, "pending")));
  }

  private requireQueueRight(actor: Actor) {
    if (!actor.permissions.has("clinic.queue.manage")) throw new ForbiddenError("Putting a patient in the queue needs queue management access");
  }

  private open(row: KioskRegistrationRecord): KioskRegistrationInput {
    if (!row.payloadSealed) throw new BusinessRuleError("This registration has already been decided", "registration_decided");
    return JSON.parse(openWithKeyring(row.payloadSealed, this.keyring)) as KioskRegistrationInput;
  }

  private async requirePending(executor: Database, actor: Actor, registrationId: string): Promise<KioskRegistrationRecord> {
    const facilityId = requireFacilityId(actor);
    const [row] = await executor
      .select()
      .from(kioskRegistration)
      .where(
        and(eq(kioskRegistration.organizationId, actor.organizationId), eq(kioskRegistration.id, registrationId), eq(kioskRegistration.facilityId, facilityId)),
      );
    const current = found(row, "Registration");
    if (current.status !== "pending") throw new BusinessRuleError("This registration has already been decided", "registration_decided");
    if (current.expiresAt.getTime() <= Date.now())
      throw new BusinessRuleError("This registration has expired — ask the person to register again", "registration_expired");
    return current;
  }

  /** Closes the submission and erases what was typed, in one transaction with the audit entry and the event. */
  private async decide(
    actor: Actor,
    row: KioskRegistrationRecord,
    status: "approved" | "linked" | "rejected",
    detail: { patientId?: string; visitId?: string | null; reason?: string; identityNote?: string },
  ) {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(kioskRegistration)
        .set({
          status,
          payloadSealed: null,
          payloadKeyId: null,
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
          decisionReason: detail.reason ?? null,
          patientId: detail.patientId ?? null,
          visitId: detail.visitId ?? null,
        })
        .where(and(eq(kioskRegistration.id, row.id), inArray(kioskRegistration.status, ["pending"])))
        .returning({ id: kioskRegistration.id });
      // Two reviewers at once: the second finds it already decided.
      if (!updated) throw new BusinessRuleError("This registration has already been decided", "registration_decided");
      await this.audit.record(tx, actor, {
        action: `kiosk.registration.${status === "approved" ? "approve" : status === "linked" ? "link" : "reject"}`,
        resourceType: "kiosk_registration",
        resourceId: row.id,
        patientId: detail.patientId,
        reason: detail.reason,
        // Approving or linking says who the person is: that the reviewer checked their identification is part of the record.
        metadata: {
          reference: row.reference,
          ...(status === "rejected" ? {} : { identityChecked: true, ...(detail.identityNote ? { identityNote: detail.identityNote } : {}) }),
        },
      });
      await this.events.record(tx, {
        type: "KioskRegistrationDecided",
        organizationId: row.organizationId,
        aggregateType: "kiosk_registration",
        aggregateId: row.id,
        facilityId: row.facilityId,
        patientId: detail.patientId ?? null,
        payload: { status },
      });
    });
  }
}
