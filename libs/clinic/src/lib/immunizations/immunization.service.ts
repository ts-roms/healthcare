import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  isFiledAs,
  localDate,
  NotFoundError,
  PgErrorCode,
  PH_TIMEZONE,
  requireFacilityId,
  timelineFacility,
  timelineInstant,
  timelineRange,
  type TimelineWindow,
  VersionConflictError,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { encounter } from "../clinic.schema";
import { found } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type { createVaccineSchema, recordAdministeredSchema, recordHistoricalSchema, updateVaccineSchema } from "./immunization.dto";
import {
  cleanOptions,
  doseText,
  expiryValid,
  isOccurrenceText,
  type Occurrence,
  occurrenceInFuture,
  occurrenceText,
  parseOccurrence,
  precisionAllowedHere,
} from "./immunization.rules";
import { immunization, type ImmunizationRecord, immunizationVaccine, type VaccineRecord } from "./immunization.schema";
import { IMMUNIZATION_CONTEXT, type ImmunizationContext, type VaccineStockLot } from "./ports";

export type VaccineView = Omit<VaccineRecord, "organizationId">;

/** One immunization record as staff see it (staff notes included; the patient's own view leaves them out). */
export interface ImmunizationView {
  id: string;
  /** The record it is filed under (the patient, or a record merged into it). */
  patientId: string;
  facility: { id: string; name: string } | null;
  encounterId: string | null;
  vaccineId: string | null;
  vaccineName: string;
  vaccineProduct: string | null;
  vaccineManufacturer: string | null;
  vaccineCodeSystem: string | null;
  vaccineCode: string | null;
  doseLabel: string | null;
  doseNumber: number | null;
  /** The dose as shown ("Dose 2", or the label as recorded). */
  dose: string | null;
  /** "2019", "2019-05", "2019-05-12" or an ISO instant, at the precision known. */
  occurrence: string;
  occurrencePrecision: ImmunizationRecord["occurrencePrecision"];
  occurrenceDate: string;
  status: ImmunizationRecord["status"];
  notDoneReason: ImmunizationRecord["statusReason"];
  notDoneReasonText: string | null;
  source: ImmunizationRecord["source"];
  performerPractitionerId: string | null;
  performerName: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  route: string | null;
  site: string | null;
  doseQuantity: number | null;
  doseUnit: string | null;
  stock: { itemId: string; locationId: string; quantity: number; returned: boolean } | null;
  sourceDescription: string | null;
  documentId: string | null;
  sourceReference: string | null;
  declaredSource: string | null;
  notes: string | null;
  adverseReaction: string | null;
  adverseReactionRecordedAt: string | null;
  adverseReactionRecordedByName: string | null;
  enteredInError: { at: string; reason: string; byName: string | null } | null;
  recordedAt: string;
  recordedByName: string | null;
}

/** An immunization accepted from an import, as the interoperability layer maps it (validated again here). */
export const importedImmunizationSchema = z.object({
  vaccineName: z.string().trim().min(1).max(200),
  vaccineCodeSystem: z.string().min(1).max(200).nullable(),
  vaccineCode: z.string().trim().min(1).max(60).nullable(),
  manufacturer: z.string().trim().min(1).max(200).nullable(),
  status: z.enum(["completed", "not_done"]),
  notDoneReasonText: z.string().trim().min(1).max(500).nullable(),
  occurrence: z.string().refine(isOccurrenceText, "No date the platform can record"),
  doseLabel: z.string().trim().min(1).max(60).nullable(),
  doseNumber: z.number().int().min(1).max(50).nullable(),
  lotNumber: z.string().trim().min(1).max(60).nullable(),
  expiryDate: z.iso.date().nullable(),
  route: z.string().trim().min(1).max(60).nullable(),
  site: z.string().trim().min(1).max(60).nullable(),
  doseQuantity: z.number().positive().max(10000).nullable(),
  doseUnit: z.string().trim().min(1).max(20).nullable(),
  performerName: z.string().trim().min(1).max(200).nullable(),
  /** The sender's statement of where the information comes from (reportOrigin, or "Recorded by the sender"). */
  sourceDescription: z.string().trim().min(1).max(300).nullable(),
});
export type ImportedImmunizationRecordInput = z.input<typeof importedImmunizationSchema>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Immunization history (docs/domains/immunizations.md): the organization's vaccine catalogue and each patient's doses —
 * given here (optionally from stock, in the same transaction), not given (with the clinician's reason), reported by
 * the patient or another provider, or accepted from a FHIR import. Records are immutable: a mistake is marked entered
 * in error (stock taken goes back, once) and a reaction noticed later is added once. No schedule, interval or due dose
 * is computed: what is due is the clinician's judgement and the organization's own protocol.
 */
@Injectable()
export class ImmunizationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly organizations: OrganizationService,
    private readonly documents: DocumentsService,
    @Inject(IMMUNIZATION_CONTEXT) private readonly context: ImmunizationContext,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  // ---- catalogue ------------------------------------------------------------------------------------------------

  async listVaccines(actor: Actor, includeInactive = false): Promise<VaccineView[]> {
    const rows = await this.db
      .select()
      .from(immunizationVaccine)
      .where(and(eq(immunizationVaccine.organizationId, actor.organizationId), includeInactive ? undefined : eq(immunizationVaccine.status, "active")))
      .orderBy(asc(immunizationVaccine.status), asc(immunizationVaccine.name), asc(immunizationVaccine.productName));
    return rows.map(vaccineView);
  }

  async createVaccine(actor: Actor, input: z.output<typeof createVaccineSchema>): Promise<VaccineView> {
    return this.unique(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(immunizationVaccine)
          .values({
            organizationId: actor.organizationId,
            name: input.name,
            productName: input.productName ?? null,
            manufacturer: input.manufacturer ?? null,
            codeSystem: input.code ? (input.codeSystem ?? "vaccine") : null,
            code: input.code ?? null,
            routes: cleanOptions(input.routes),
            sites: cleanOptions(input.sites),
            dosesInSeries: input.dosesInSeries ?? null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
        const created = found(row, "Vaccine");
        await this.audit.record(tx, actor, {
          action: "immunization.catalog.create",
          resourceType: "immunization_vaccine",
          resourceId: created.id,
          metadata: { name: created.name, code: created.code },
        });
        return vaccineView(created);
      }),
    );
  }

  async updateVaccine(actor: Actor, vaccineId: string, input: z.output<typeof updateVaccineSchema>): Promise<VaccineView> {
    return this.unique(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(immunizationVaccine)
          .where(and(eq(immunizationVaccine.organizationId, actor.organizationId), eq(immunizationVaccine.id, vaccineId)))
          .for("update");
        const before = found(current, "Vaccine");
        if (before.version !== input.version) throw new VersionConflictError("Vaccine", input.version);
        const code = input.code === undefined ? before.code : input.code;
        const codeSystem = code ? ((input.codeSystem === undefined ? before.codeSystem : input.codeSystem) ?? "vaccine") : null;
        const changes = {
          name: input.name ?? before.name,
          productName: input.productName === undefined ? before.productName : input.productName,
          manufacturer: input.manufacturer === undefined ? before.manufacturer : input.manufacturer,
          code,
          codeSystem,
          routes: input.routes ? cleanOptions(input.routes) : before.routes,
          sites: input.sites ? cleanOptions(input.sites) : before.sites,
          dosesInSeries: input.dosesInSeries === undefined ? before.dosesInSeries : input.dosesInSeries,
          status: input.status ?? before.status,
        };
        const [row] = await tx
          .update(immunizationVaccine)
          .set({ ...changes, updatedBy: actor.userId, updatedAt: new Date(), version: before.version + 1 })
          .where(eq(immunizationVaccine.id, vaccineId))
          .returning();
        const changed = Object.fromEntries(
          Object.entries(changes)
            .filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof typeof changes]))
            .map(([k, v]) => [k, { from: before[k as keyof typeof changes], to: v }]),
        );
        await this.audit.record(tx, actor, {
          action: "immunization.catalog.update",
          resourceType: "immunization_vaccine",
          resourceId: vaccineId,
          changes: changed,
        });
        return vaccineView(found(row, "Vaccine"));
      }),
    );
  }

  // ---- stock ------------------------------------------------------------------------------------------------------

  /** Vaccine lots in stock at the selected facility (to take a dose from). */
  vaccineStock(actor: Actor): Promise<VaccineStockLot[]> {
    return this.context.vaccineStock(actor.organizationId, requireFacilityId(actor));
  }

  // ---- recording --------------------------------------------------------------------------------------------------

  /** A dose given — or not given, with the reason — at the selected facility, optionally taken from stock. */
  async recordAdministered(actor: Actor, patientId: string, input: z.output<typeof recordAdministeredSchema>): Promise<ImmunizationView> {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const now = new Date();
    const occurrence: Occurrence = input.occurrence
      ? parseOccurrence(input.occurrence, facility.timezone)
      : { date: localDate(now, facility.timezone), precision: "time", at: now };
    if (!precisionAllowedHere(occurrence.precision)) throw new BusinessRuleError("Give the day the dose was given", "occurrence_imprecise");
    if (occurrenceInFuture(occurrence, localDate(now, facility.timezone), now))
      throw new BusinessRuleError("The date given is in the future", "occurrence_in_future");
    const practitioner = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const id = randomUUID();

    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        const vaccine = await this.activeVaccine(tx, actor.organizationId, input.vaccineId);
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId, facilityId);
        if (input.route && vaccine.routes.length && !vaccine.routes.some((r) => same(r, input.route!))) {
          throw new BusinessRuleError(`Choose one of the routes listed for ${vaccine.name}`, "route_not_listed");
        }
        if (input.site && vaccine.sites.length && !vaccine.sites.some((s) => same(s, input.site!))) {
          throw new BusinessRuleError(`Choose one of the sites listed for ${vaccine.name}`, "site_not_listed");
        }
        let lotNumber = input.lotNumber ?? null;
        let expiryDate = input.expiryDate ?? null;
        let stock: { itemId: string; locationId: string; quantity: number; movementGroupId: string } | null = null;
        if (input.stock && input.status === "completed") {
          const taken = await this.context.takeStock(tx, actor, {
            immunizationId: id,
            locationId: input.stock.locationId,
            lotId: input.stock.lotId,
            quantity: input.stock.quantity,
            reference: `IMM-${id.slice(0, 8).toUpperCase()}`,
          });
          if (taken.lotNumber) {
            if (lotNumber && !same(lotNumber, taken.lotNumber)) {
              throw new BusinessRuleError(`The stock lot is ${taken.lotNumber}, not ${lotNumber}`, "lot_mismatch");
            }
            lotNumber = taken.lotNumber;
          }
          if (taken.expiryDate) {
            if (expiryDate && expiryDate !== taken.expiryDate) throw new BusinessRuleError(`The stock lot expires ${taken.expiryDate}`, "lot_mismatch");
            expiryDate = taken.expiryDate;
          }
          stock = { itemId: taken.itemId, locationId: input.stock.locationId, quantity: input.stock.quantity, movementGroupId: taken.movementGroupId };
        }
        if (input.status === "completed") {
          if (!lotNumber) throw new BusinessRuleError("Give the lot number of the dose given", "lot_number_required");
          if (!expiryValid(expiryDate, occurrence.date)) throw new BusinessRuleError("The lot had expired on the day given", "lot_expired");
        }
        const [inserted] = await tx
          .insert(immunization)
          .values({
            id,
            organizationId: actor.organizationId,
            patientId,
            facilityId,
            encounterId: input.encounterId ?? null,
            vaccineId: vaccine.id,
            vaccineName: vaccine.name,
            vaccineProduct: vaccine.productName,
            vaccineManufacturer: vaccine.manufacturer,
            vaccineCodeSystem: vaccine.codeSystem,
            vaccineCode: vaccine.code,
            doseLabel: input.doseLabel ?? null,
            doseNumber: input.doseNumber ?? null,
            occurrenceDate: occurrence.date,
            occurrencePrecision: occurrence.precision,
            occurredAt: occurrence.at,
            status: input.status,
            statusReason: input.status === "not_done" ? (input.notDoneReason ?? "other") : null,
            statusReasonText: input.status === "not_done" ? (input.notDoneReasonText ?? null) : null,
            source: "administered_here",
            performerPractitionerId: practitioner?.id ?? null,
            performerName: practitioner?.displayName ?? actor.displayName,
            lotNumber: input.status === "completed" ? lotNumber : null,
            expiryDate: input.status === "completed" ? expiryDate : null,
            route: input.route ?? null,
            site: input.site ?? null,
            doseQuantity: input.doseQuantity ?? null,
            doseUnit: input.doseUnit ?? null,
            stockItemId: stock?.itemId ?? null,
            stockLocationId: stock?.locationId ?? null,
            stockQuantity: stock?.quantity ?? null,
            stockMovementGroupId: stock?.movementGroupId ?? null,
            notes: input.notes ?? null,
            adverseReaction: input.adverseReaction ?? null,
            adverseReactionRecordedBy: input.adverseReaction ? actor.userId : null,
            adverseReactionRecordedAt: input.adverseReaction ? now : null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Immunization");
        await this.recorded(tx, actor, created, { fromStock: Boolean(stock) });
        return created;
      }),
    );
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /** A dose reported by the patient or another provider, as precise as the source (a year, a month or a day). */
  async recordHistorical(actor: Actor, patientId: string, input: z.output<typeof recordHistoricalSchema>): Promise<ImmunizationView> {
    const timeZone = await this.timeZone(actor);
    const now = new Date();
    const occurrence = parseOccurrence(input.occurrence, timeZone);
    if (occurrenceInFuture(occurrence, localDate(now, timeZone), now)) throw new BusinessRuleError("The date given is in the future", "occurrence_in_future");
    if (input.documentId) {
      const doc = (await this.documents.describe(actor.organizationId, [input.documentId])).get(input.documentId);
      if (!doc || doc.status !== "available" || !(await isFiledAs(this.db, doc.patientId, patientId))) {
        throw new BusinessRuleError("Link a document uploaded for this patient", "document_not_of_patient");
      }
    }
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        const vaccine = input.vaccineId ? await this.anyVaccine(tx, actor.organizationId, input.vaccineId) : null;
        const [inserted] = await tx
          .insert(immunization)
          .values({
            organizationId: actor.organizationId,
            patientId,
            vaccineId: vaccine?.id ?? null,
            vaccineName: vaccine?.name ?? input.vaccineName!,
            vaccineProduct: vaccine?.productName ?? null,
            vaccineManufacturer: vaccine?.manufacturer ?? null,
            vaccineCodeSystem: vaccine?.codeSystem ?? null,
            vaccineCode: vaccine?.code ?? null,
            doseLabel: input.doseLabel ?? null,
            doseNumber: input.doseNumber ?? null,
            occurrenceDate: occurrence.date,
            occurrencePrecision: occurrence.precision,
            occurredAt: occurrence.at,
            status: "completed",
            source: "historical",
            performerName: input.givenBy ?? null,
            lotNumber: input.lotNumber ?? null,
            sourceDescription: input.sourceDescription,
            documentId: input.documentId ?? null,
            notes: input.notes ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Immunization");
        await this.recorded(tx, actor, created, {});
        return created;
      }),
    );
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /**
   * An immunization accepted from a FHIR import, in the caller's transaction (the review queue's accept). Kept as
   * received: the vaccine as named and coded by the sender, never matched to the catalogue.
   */
  async recordImportedIn(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    input: ImportedImmunizationRecordInput,
    origin: { reference: string; declaredSource: string | null },
  ): Promise<{ id: string }> {
    const parsed = importedImmunizationSchema.safeParse(input);
    if (!parsed.success) {
      throw new BusinessRuleError(
        "The imported entry cannot be recorded as it is",
        "invalid_import_entry",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    const entry = parsed.data;
    const occurrence = parseOccurrence(entry.occurrence, PH_TIMEZONE);
    const notDone = entry.status === "not_done";
    const [inserted] = await tx
      .insert(immunization)
      .values({
        organizationId: actor.organizationId,
        patientId,
        vaccineName: entry.vaccineName,
        vaccineManufacturer: entry.manufacturer,
        vaccineCodeSystem: entry.vaccineCode ? entry.vaccineCodeSystem : null,
        vaccineCode: entry.vaccineCode,
        doseLabel: entry.doseLabel,
        doseNumber: entry.doseNumber,
        occurrenceDate: occurrence.date,
        occurrencePrecision: occurrence.precision,
        occurredAt: occurrence.at,
        status: entry.status,
        statusReason: notDone ? "other" : null,
        statusReasonText: notDone ? (entry.notDoneReasonText ?? "Not given, as recorded by the sender") : null,
        source: "external_import",
        performerName: entry.performerName,
        lotNumber: notDone ? null : entry.lotNumber,
        expiryDate: notDone ? null : entry.expiryDate,
        route: notDone ? null : entry.route,
        site: notDone ? null : entry.site,
        doseQuantity: notDone || entry.doseUnit === null ? null : entry.doseQuantity,
        doseUnit: notDone || entry.doseQuantity === null ? null : entry.doseUnit,
        sourceDescription: entry.sourceDescription,
        sourceReference: origin.reference,
        declaredSource: origin.declaredSource,
        recordedBy: actor.userId,
      })
      .returning();
    const created = found(inserted, "Immunization");
    await this.recorded(tx, actor, created, { sourceReference: origin.reference });
    return { id: created.id };
  }

  /** A reaction noticed after a dose given (once; never on a record in error or a dose not given). Not an allergy. */
  async addReaction(actor: Actor, immunizationId: string, adverseReaction: string): Promise<ImmunizationView> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, immunizationId);
      if (current.enteredInErrorAt) throw new BusinessRuleError("The record is marked entered in error", "already_entered_in_error");
      if (current.status !== "completed") throw new BusinessRuleError("A reaction is recorded for a dose given", "not_given");
      if (current.adverseReaction) throw new BusinessRuleError("A reaction is already recorded for this dose", "reaction_recorded");
      const [updated] = await tx
        .update(immunization)
        .set({ adverseReaction, adverseReactionRecordedBy: actor.userId, adverseReactionRecordedAt: new Date() })
        .where(eq(immunization.id, immunizationId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "immunization.reaction",
        resourceType: "immunization",
        resourceId: immunizationId,
        patientId: current.patientId,
      });
      return found(updated, "Immunization");
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /** Marks a record entered in error with a reason (never deleted); stock the dose took goes back to its lot, once. */
  async markEnteredInError(actor: Actor, immunizationId: string, reason: string): Promise<ImmunizationView> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, immunizationId);
      if (current.enteredInErrorAt) throw new BusinessRuleError("The record is already marked entered in error", "already_entered_in_error");
      const returned = current.stockMovementGroupId
        ? await this.context.returnStock(tx, actor, { immunizationId, reason: `Immunization entered in error: ${reason}` })
        : null;
      const [updated] = await tx
        .update(immunization)
        .set({
          enteredInErrorAt: new Date(),
          enteredInErrorBy: actor.userId,
          enteredInErrorReason: reason,
          stockReturnGroupId: returned?.movementGroupId ?? null,
        })
        .where(eq(immunization.id, immunizationId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "immunization.entered-in-error",
        resourceType: "immunization",
        resourceId: immunizationId,
        patientId: current.patientId,
        reason,
        changes: { status: { from: "recorded", to: "entered_in_error" } },
        metadata: { stockReturned: Boolean(returned) },
      });
      await this.events.record(tx, {
        type: "ImmunizationEnteredInError",
        organizationId: actor.organizationId,
        aggregateType: "immunization",
        aggregateId: immunizationId,
        facilityId: current.facilityId,
        patientId: current.patientId,
        payload: { immunizationId, stockReturned: Boolean(returned) },
      });
      return found(updated, "Immunization");
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  // ---- reading ----------------------------------------------------------------------------------------------------

  /** The patient's immunization history (and records merged into it), latest first; entries in error included, marked. */
  async list(actor: Actor, patientId: string): Promise<ImmunizationView[]> {
    if (!(await this.patients.summaries(actor.organizationId, [patientId])).has(patientId)) throw new NotFoundError("Patient");
    const rows = await this.rows(actor.organizationId, patientId);
    await this.audit.recordStandalone(actor, {
      action: "immunization.view",
      resourceType: "immunization",
      patientId,
      metadata: { count: rows.length },
    });
    return this.views(actor.organizationId, rows);
  }

  /** Doses recorded in one consultation. */
  async listForEncounter(actor: Actor, encounterId: string): Promise<ImmunizationView[]> {
    const rows = await this.db
      .select()
      .from(immunization)
      .where(and(eq(immunization.organizationId, actor.organizationId), eq(immunization.encounterId, encounterId)))
      .orderBy(desc(immunization.recordedAt));
    const [first] = rows;
    if (first) {
      await this.audit.recordStandalone(actor, {
        action: "immunization.view",
        resourceType: "immunization",
        patientId: first.patientId,
        metadata: { encounterId, count: rows.length },
      });
    }
    return this.views(actor.organizationId, rows);
  }

  /** Every record of the patient (entries in error included) for a record export. Not audited here: the caller audits. */
  patientRecord(organizationId: string, patientId: string): Promise<ImmunizationRecord[]> {
    return this.rows(organizationId, patientId, "asc");
  }

  /**
   * What the patient sees in MyHealth: doses given and reported (not in error, not "not given"), with the vaccine, dose,
   * date and where it was given. No staff notes, reasons, lot details or who recorded it. Not audited here.
   */
  async patientView(organizationId: string, patientId: string) {
    const rows = (await this.rows(organizationId, patientId)).filter((r) => !r.enteredInErrorAt && r.status === "completed");
    const facilities = await this.facilityNames(organizationId, rows);
    return rows.map((r) => ({
      id: r.id,
      vaccineName: r.vaccineName,
      vaccineProduct: r.vaccineProduct,
      dose: doseText(r),
      occurrence: occurrenceText({ date: r.occurrenceDate, precision: r.occurrencePrecision, at: r.occurredAt }),
      occurrencePrecision: r.occurrencePrecision,
      source: r.source,
      where: r.facilityId ? (facilities.get(r.facilityId) ?? null) : r.performerName,
    }));
  }

  /** The latest records for Patient 360 (not in error): short display fields only. Not audited here. */
  async workspace(organizationId: string, patientId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(immunization)
      .where(and(eq(immunization.organizationId, organizationId), filedAsPatient(immunization.patientId, patientId), isNull(immunization.enteredInErrorAt)))
      .orderBy(desc(immunization.occurrenceDate), sql`${immunization.occurredAt} DESC NULLS LAST`, desc(immunization.recordedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facilityId: r.facilityId,
      vaccineName: r.vaccineName,
      dose: doseText(r),
      occurrence: occurrenceText({ date: r.occurrenceDate, precision: r.occurrencePrecision, at: r.occurredAt }),
      occurrencePrecision: r.occurrencePrecision,
      status: r.status,
      source: r.source,
      hasReaction: r.adverseReaction !== null,
    }));
  }

  /**
   * Timeline rows: when it was given (with a time), otherwise when it was recorded. Vaccine, dose, status and source
   * only — no notes, reasons or reactions. Entries without a facility are left out by a facility filter.
   */
  timeline(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = sql`coalesce(${immunization.occurredAt}, ${immunization.recordedAt})`;
    return this.db
      .select({
        id: immunization.id,
        patientId: immunization.patientId,
        facilityId: immunization.facilityId,
        at: timelineInstant(at),
        vaccineName: immunization.vaccineName,
        doseLabel: immunization.doseLabel,
        doseNumber: immunization.doseNumber,
        occurrenceDate: immunization.occurrenceDate,
        occurrencePrecision: immunization.occurrencePrecision,
        occurredAt: immunization.occurredAt,
        status: immunization.status,
        source: immunization.source,
        encounterId: immunization.encounterId,
        enteredInErrorAt: immunization.enteredInErrorAt,
      })
      .from(immunization)
      .where(
        and(
          eq(immunization.organizationId, organizationId),
          filedAsPatient(immunization.patientId, patientId),
          timelineRange("immunization", at, immunization.id, window),
          timelineFacility(immunization.facilityId, window),
        ),
      )
      .orderBy(desc(at), desc(immunization.id))
      .limit(window.limit);
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private async recorded(tx: DbExecutor, actor: Actor, row: ImmunizationRecord, metadata: Record<string, unknown>): Promise<void> {
    await this.audit.record(tx, actor, {
      action: "immunization.record",
      resourceType: "immunization",
      resourceId: row.id,
      patientId: row.patientId,
      metadata: { source: row.source, status: row.status, vaccineId: row.vaccineId, encounterId: row.encounterId, ...metadata },
    });
    await this.events.record(tx, {
      type: "ImmunizationRecorded",
      organizationId: actor.organizationId,
      aggregateType: "immunization",
      aggregateId: row.id,
      facilityId: row.facilityId,
      patientId: row.patientId,
      payload: { immunizationId: row.id, vaccineId: row.vaccineId, encounterId: row.encounterId, source: row.source, status: row.status },
    });
  }

  private rows(organizationId: string, patientId: string, order: "asc" | "desc" = "desc") {
    const dir = order === "asc" ? asc : desc;
    return this.db
      .select()
      .from(immunization)
      .where(and(eq(immunization.organizationId, organizationId), filedAsPatient(immunization.patientId, patientId)))
      .orderBy(
        dir(immunization.occurrenceDate),
        sql`${immunization.occurredAt} ${sql.raw(order === "asc" ? "ASC NULLS FIRST" : "DESC NULLS LAST")}`,
        dir(immunization.recordedAt),
      )
      .limit(1000);
  }

  private async lock(tx: DbExecutor, organizationId: string, id: string): Promise<ImmunizationRecord> {
    const [row] = await tx
      .select()
      .from(immunization)
      .where(and(eq(immunization.organizationId, organizationId), eq(immunization.id, id)))
      .for("update");
    return found(row, "Immunization");
  }

  private async anyVaccine(executor: DbExecutor, organizationId: string, id: string): Promise<VaccineRecord> {
    const [row] = await executor
      .select()
      .from(immunizationVaccine)
      .where(and(eq(immunizationVaccine.organizationId, organizationId), eq(immunizationVaccine.id, id)));
    return found(row, "Vaccine");
  }

  private async activeVaccine(executor: DbExecutor, organizationId: string, id: string): Promise<VaccineRecord> {
    const vaccine = await this.anyVaccine(executor, organizationId, id);
    if (vaccine.status !== "active") throw new BusinessRuleError(`${vaccine.name} is no longer in the catalogue`, "vaccine_inactive");
    return vaccine;
  }

  private async checkEncounter(tx: DbExecutor, organizationId: string, encounterId: string, patientId: string, facilityId: string): Promise<void> {
    const [row] = await tx
      .select({ patientId: encounter.patientId, facilityId: encounter.facilityId, status: encounter.status })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    const consultation = found(row, "Encounter");
    if (consultation.patientId !== patientId) throw new BusinessRuleError("The consultation is another patient's", "encounter_other_patient");
    if (consultation.facilityId !== facilityId) throw new BusinessRuleError("The consultation is at another facility", "encounter_other_facility");
    if (consultation.status === "entered_in_error") throw new BusinessRuleError("The consultation is marked entered in error", "encounter_entered_in_error");
  }

  private async timeZone(actor: Actor): Promise<string> {
    if (!actor.facilityId) return PH_TIMEZONE;
    return (await this.organizations.getFacility(actor.organizationId, actor.facilityId)).timezone;
  }

  /** A patient outside the organization is not found (the composite foreign key). */
  private async patientScoped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.foreignKeyViolation && pg.constraint?.includes("patient_id")) throw new NotFoundError("Patient");
      throw error;
    }
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new BusinessRuleError("An active vaccine with this name and product, or this code, is already in the catalogue", "vaccine_exists");
      }
      throw error;
    }
  }

  private async facilityNames(organizationId: string, rows: Array<{ facilityId: string | null }>): Promise<Map<string, string>> {
    if (!rows.some((r) => r.facilityId)) return new Map();
    const facilities = await this.organizations.listFacilities(organizationId);
    return new Map(facilities.map((f) => [f.id, f.name]));
  }

  private async views(organizationId: string, rows: ImmunizationRecord[]): Promise<ImmunizationView[]> {
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy, r.adverseReactionRecordedBy]).filter((id): id is string => Boolean(id))),
    ];
    const [names, facilities] = await Promise.all([
      userIds.length ? this.context.staffNames(organizationId, userIds) : Promise.resolve(new Map<string, string>()),
      this.facilityNames(organizationId, rows),
    ]);
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facility: r.facilityId ? { id: r.facilityId, name: facilities.get(r.facilityId) ?? "" } : null,
      encounterId: r.encounterId,
      vaccineId: r.vaccineId,
      vaccineName: r.vaccineName,
      vaccineProduct: r.vaccineProduct,
      vaccineManufacturer: r.vaccineManufacturer,
      vaccineCodeSystem: r.vaccineCodeSystem,
      vaccineCode: r.vaccineCode,
      doseLabel: r.doseLabel,
      doseNumber: r.doseNumber,
      dose: doseText(r),
      occurrence: occurrenceText({ date: r.occurrenceDate, precision: r.occurrencePrecision, at: r.occurredAt }),
      occurrencePrecision: r.occurrencePrecision,
      occurrenceDate: r.occurrenceDate,
      status: r.status,
      notDoneReason: r.statusReason,
      notDoneReasonText: r.statusReasonText,
      source: r.source,
      performerPractitionerId: r.performerPractitionerId,
      performerName: r.performerName,
      lotNumber: r.lotNumber,
      expiryDate: r.expiryDate,
      route: r.route,
      site: r.site,
      doseQuantity: r.doseQuantity,
      doseUnit: r.doseUnit,
      stock:
        r.stockItemId && r.stockLocationId && r.stockQuantity
          ? { itemId: r.stockItemId, locationId: r.stockLocationId, quantity: r.stockQuantity, returned: r.stockReturnGroupId !== null }
          : null,
      sourceDescription: r.sourceDescription,
      documentId: r.documentId,
      sourceReference: r.sourceReference,
      declaredSource: r.declaredSource,
      notes: r.notes,
      adverseReaction: r.adverseReaction,
      adverseReactionRecordedAt: iso(r.adverseReactionRecordedAt),
      adverseReactionRecordedByName: r.adverseReactionRecordedBy ? (names.get(r.adverseReactionRecordedBy) ?? null) : null,
      enteredInError:
        r.enteredInErrorAt && r.enteredInErrorReason
          ? {
              at: r.enteredInErrorAt.toISOString(),
              reason: r.enteredInErrorReason,
              byName: r.enteredInErrorBy ? (names.get(r.enteredInErrorBy) ?? null) : null,
            }
          : null,
      recordedAt: r.recordedAt.toISOString(),
      recordedByName: names.get(r.recordedBy) ?? null,
    }));
  }
}

function vaccineView(row: VaccineRecord): VaccineView {
  const { organizationId: _organizationId, ...rest } = row;
  return rest;
}
