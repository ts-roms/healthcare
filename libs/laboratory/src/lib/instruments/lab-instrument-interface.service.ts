import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  requireFacilityId,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import { labInstrument, labOrder, labOrderItem, labSpecimen, labTest } from "../laboratory.schema";
import { found } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { LabResultService } from "../results/lab-result.service";
import type { instrumentInterfaceSchema, instrumentTestCodeSchema } from "./instrument-interface.dto";
import { INSTRUMENT_MESSAGE_READER, type InstrumentMessageReader, type InstrumentReadResult } from "./instrument-interface.ports";
import {
  type InstrumentMatchProblem,
  labInstrumentInterface,
  labInstrumentMessage,
  labInstrumentResult,
  type LabInstrumentResultRecord,
  labInstrumentTestCode,
} from "./instrument-interface.schema";
import { instrumentValue } from "./instrument-interface.rules";

const DECIDED_LIMIT = 200;

/**
 * Analyzer interfaces (docs/domains/laboratory-instruments.md). An instrument's interface names its protocol and where
 * its messages carry the specimen's accession number; analyzer test codes map to catalog tests. Messages an instrument
 * sends (through an on-site gateway's integration account) are kept as received; each result is matched to a specimen
 * and an ordered test and waits for staff, who accept it into the ordinary result workflow — entered in the same
 * transaction, attributed to the instrument, so QC policy, reagent counting, verification and approval all apply — or
 * dismiss it with a reason. Nothing an analyzer sends becomes a result without a person accepting it.
 */
@Injectable()
export class LabInstrumentInterfaceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly results: LabResultService,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    @Inject(INSTRUMENT_MESSAGE_READER) private readonly reader: InstrumentMessageReader,
  ) {}

  // ---- configuration --------------------------------------------------------------------------------------------

  async settings(actor: Actor, instrumentId: string) {
    const instrument = await this.instrument(this.db, actor.organizationId, instrumentId);
    const [config] = await this.db.select().from(labInstrumentInterface).where(eq(labInstrumentInterface.instrumentId, instrument.id));
    const codes = await this.db
      .select({ analyzerCode: labInstrumentTestCode.analyzerCode, testId: labTest.id, testCode: labTest.code, testName: labTest.name })
      .from(labInstrumentTestCode)
      .innerJoin(labTest, eq(labTest.id, labInstrumentTestCode.testId))
      .where(eq(labInstrumentTestCode.instrumentId, instrument.id))
      .orderBy(asc(labInstrumentTestCode.analyzerCode));
    return {
      instrumentId: instrument.id,
      instrumentCode: instrument.code,
      interface: config
        ? {
            protocol: config.protocol,
            specimenIdField: config.specimenIdField,
            enabled: config.enabled,
            updatedAt: config.updatedAt.toISOString(),
            version: config.version,
          }
        : null,
      testCodes: codes,
    };
  }

  async configure(actor: Actor, instrumentId: string, input: z.infer<typeof instrumentInterfaceSchema>) {
    await this.db.transaction(async (tx) => {
      const instrument = await this.instrument(tx, actor.organizationId, instrumentId);
      const [current] = await tx.select().from(labInstrumentInterface).where(eq(labInstrumentInterface.instrumentId, instrument.id)).for("update");
      if (current && input.version !== current.version) throw new VersionConflictError("Instrument interface", current.version);
      const values = {
        protocol: input.protocol,
        specimenIdField: input.specimenIdField,
        enabled: input.enabled,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current) {
        await tx
          .update(labInstrumentInterface)
          .set({ ...values, version: current.version + 1 })
          .where(eq(labInstrumentInterface.id, current.id));
      } else {
        await tx.insert(labInstrumentInterface).values({ organizationId: actor.organizationId, instrumentId: instrument.id, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "lab.instrument.interface.configure",
        resourceType: "lab_instrument",
        resourceId: instrument.id,
        metadata: { protocol: input.protocol, specimenIdField: input.specimenIdField, enabled: input.enabled },
      });
    });
    return this.settings(actor, instrumentId);
  }

  async setTestCode(actor: Actor, instrumentId: string, input: z.infer<typeof instrumentTestCodeSchema>) {
    await this.db.transaction(async (tx) => {
      const instrument = await this.instrument(tx, actor.organizationId, instrumentId);
      const code = input.analyzerCode.trim();
      await tx.delete(labInstrumentTestCode).where(and(eq(labInstrumentTestCode.instrumentId, instrument.id), eq(labInstrumentTestCode.analyzerCode, code)));
      if (input.testId) {
        found(
          (
            await tx
              .select({ id: labTest.id })
              .from(labTest)
              .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, input.testId)))
          )[0],
          "Test",
        );
        await tx.insert(labInstrumentTestCode).values({
          organizationId: actor.organizationId,
          instrumentId: instrument.id,
          analyzerCode: code,
          testId: input.testId,
          updatedBy: actor.userId,
        });
      }
      await this.audit.record(tx, actor, {
        action: "lab.instrument.test-code",
        resourceType: "lab_instrument",
        resourceId: instrument.id,
        metadata: { analyzerCode: code, testId: input.testId },
      });
    });
    return this.settings(actor, instrumentId);
  }

  // ---- receiving ------------------------------------------------------------------------------------------------

  /**
   * Receives one message from an instrument. A message the reader cannot read is kept as rejected and refused (422,
   * with the reason). A message already received (same instrument and control id) is acknowledged without adding
   * anything again.
   */
  async receive(actor: Actor, instrumentId: string, text: string) {
    const instrument = await this.instrument(this.db, actor.organizationId, instrumentId);
    const [config] = await this.db.select().from(labInstrumentInterface).where(eq(labInstrumentInterface.instrumentId, instrument.id));
    if (!config?.enabled) throw new BusinessRuleError("This instrument's interface is not enabled", "interface_not_enabled");
    const read = this.reader.read(config.protocol, text, config.specimenIdField);
    if (!read.ok) {
      await this.db.transaction(async (tx) => {
        const [message] = await tx
          .insert(labInstrumentMessage)
          .values({
            organizationId: actor.organizationId,
            facilityId: instrument.facilityId,
            instrumentId: instrument.id,
            protocol: config.protocol,
            content: text,
            outcome: "rejected",
            errorCode: read.code,
            receivedBy: actor.userId,
          })
          .returning({ id: labInstrumentMessage.id });
        await this.audit.record(tx, actor, {
          action: "lab.instrument.message.receive",
          resourceType: "lab_instrument_message",
          resourceId: message!.id,
          outcome: "failure",
          reason: read.code,
          metadata: { instrumentId: instrument.id, facilityId: instrument.facilityId },
        });
      });
      throw new BusinessRuleError(`The message could not be read: ${read.detail}`, "instrument_message_unreadable", { reason: read.code });
    }
    if (read.controlId) {
      const [previous] = await this.db
        .select({ id: labInstrumentMessage.id, resultCount: labInstrumentMessage.resultCount })
        .from(labInstrumentMessage)
        .where(
          and(
            eq(labInstrumentMessage.instrumentId, instrument.id),
            eq(labInstrumentMessage.controlId, read.controlId),
            eq(labInstrumentMessage.outcome, "read"),
          ),
        );
      if (previous) return { messageId: previous.id, controlId: read.controlId, duplicate: true, results: previous.resultCount, matched: null };
    }
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .insert(labInstrumentMessage)
        .values({
          organizationId: actor.organizationId,
          facilityId: instrument.facilityId,
          instrumentId: instrument.id,
          protocol: config.protocol,
          controlId: read.controlId,
          content: text,
          outcome: "read",
          resultCount: read.results.length,
          receivedBy: actor.userId,
        })
        .returning({ id: labInstrumentMessage.id });
      let matched = 0;
      for (const result of read.results) {
        const match = await this.match(tx, actor.organizationId, instrument.id, instrument.facilityId, result);
        if (!match.problem) matched += 1;
        await tx.insert(labInstrumentResult).values({
          organizationId: actor.organizationId,
          facilityId: instrument.facilityId,
          instrumentId: instrument.id,
          messageId: message!.id,
          sequence: result.sequence,
          specimenCode: result.specimenCode,
          analyzerCode: result.analyzerCode,
          valueRaw: result.value,
          unitsRaw: result.units,
          referenceRaw: result.referenceRange,
          flagsRaw: result.flags,
          statusRaw: result.status,
          observedRaw: result.observedAt,
          patientId: match.patientId,
          specimenId: match.specimenId,
          orderItemId: match.orderItemId,
          testId: match.testId,
          matchProblem: match.problem,
          state: "pending",
        });
      }
      await this.audit.record(tx, actor, {
        action: "lab.instrument.message.receive",
        resourceType: "lab_instrument_message",
        resourceId: message!.id,
        metadata: { instrumentId: instrument.id, facilityId: instrument.facilityId, controlId: read.controlId, results: read.results.length, matched },
      });
      return { messageId: message!.id, controlId: read.controlId, duplicate: false, results: read.results.length, matched };
    });
  }

  // ---- review ---------------------------------------------------------------------------------------------------

  /** Results waiting for review at the selected facility (oldest first), or the latest decided ones. */
  async list(actor: Actor, state: "pending" | "decided", instrumentId?: string) {
    const facilityId = requireFacilityId(actor);
    const conditions = [eq(labInstrumentResult.organizationId, actor.organizationId), eq(labInstrumentResult.facilityId, facilityId)];
    conditions.push(state === "pending" ? eq(labInstrumentResult.state, "pending") : ne(labInstrumentResult.state, "pending"));
    if (instrumentId) conditions.push(eq(labInstrumentResult.instrumentId, instrumentId));
    const rows = await this.db
      .select({
        result: labInstrumentResult,
        instrumentCode: labInstrument.code,
        testName: labTest.name,
        testUnit: labTest.unit,
        accessionNumber: labSpecimen.accessionNumber,
        orderNumber: labOrder.orderNumber,
        itemStatus: labOrderItem.status,
      })
      .from(labInstrumentResult)
      .innerJoin(labInstrument, eq(labInstrument.id, labInstrumentResult.instrumentId))
      .leftJoin(labTest, eq(labTest.id, labInstrumentResult.testId))
      .leftJoin(labSpecimen, eq(labSpecimen.id, labInstrumentResult.specimenId))
      .leftJoin(labOrderItem, eq(labOrderItem.id, labInstrumentResult.orderItemId))
      .leftJoin(labOrder, eq(labOrder.id, labOrderItem.orderId))
      .where(and(...conditions))
      .orderBy(...(state === "pending" ? [asc(labInstrumentResult.createdAt), asc(labInstrumentResult.sequence)] : [desc(labInstrumentResult.decidedAt)]))
      .limit(state === "pending" ? 500 : DECIDED_LIMIT);
    const patients = await this.context.patientBriefs(actor.organizationId, [
      ...new Set(rows.map((r) => r.result.patientId).filter((id): id is string => Boolean(id))),
    ]);
    const names = await this.context.staffNames(actor.organizationId, [
      ...new Set(rows.map((r) => r.result.decidedBy).filter((id): id is string => Boolean(id))),
    ]);
    await this.audit.recordStandalone(actor, {
      action: "lab.instrument.result.list",
      resourceType: "lab_instrument_result",
      metadata: { state, count: rows.length },
    });
    return rows.map(({ result: r, ...joined }) => ({
      id: r.id,
      instrumentId: r.instrumentId,
      instrumentCode: joined.instrumentCode,
      receivedAt: r.createdAt.toISOString(),
      specimenCode: r.specimenCode,
      analyzerCode: r.analyzerCode,
      value: r.valueRaw,
      units: r.unitsRaw,
      referenceRange: r.referenceRaw,
      flags: r.flagsRaw,
      status: r.statusRaw,
      observedAt: r.observedRaw,
      matchProblem: r.matchProblem,
      patient: r.patientId ? (patients.get(r.patientId) ?? null) : null,
      patientId: r.patientId,
      orderItemId: r.orderItemId,
      orderNumber: joined.orderNumber,
      accessionNumber: joined.accessionNumber,
      testName: joined.testName,
      testUnit: joined.testUnit,
      itemStatus: joined.itemStatus,
      state: r.state,
      resultId: r.resultId,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
      dismissReason: r.dismissReason,
    }));
  }

  /**
   * Accepts a matched result: it is entered as the test's result, attributed to the instrument, in the same
   * transaction (all result-entry rules apply: the specimen received, no result yet, QC policy, competency policy).
   * The value must suit the test: a number for a numeric test, in the test's unit when the analyzer sends one.
   */
  async accept(actor: Actor, id: string) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, facilityId, id);
      if (row.matchProblem || !row.orderItemId || !row.testId) {
        throw new BusinessRuleError("This result is not matched to an ordered test", "instrument_result_unmatched");
      }
      const [test] = await tx.select().from(labTest).where(eq(labTest.id, row.testId));
      const value = instrumentValue(found(test, "Test"), row.valueRaw, row.unitsRaw);
      if (!value.ok) throw new BusinessRuleError(value.message, value.code);
      const result = await this.results.enterWithin(tx, actor, row.orderItemId, { ...value.input, instrumentId: row.instrumentId });
      await tx
        .update(labInstrumentResult)
        .set({ state: "accepted", resultId: result.id, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(labInstrumentResult.id, row.id));
      await this.audit.record(tx, actor, {
        action: "lab.instrument.result.accept",
        resourceType: "lab_instrument_result",
        resourceId: row.id,
        patientId: row.patientId ?? undefined,
        metadata: { resultId: result.id, orderItemId: row.orderItemId, instrumentId: row.instrumentId },
      });
      return { id: row.id, state: "accepted" as const, resultId: result.id };
    });
  }

  async dismiss(actor: Actor, id: string, reason: string) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, facilityId, id);
      await tx
        .update(labInstrumentResult)
        .set({ state: "dismissed", dismissReason: reason, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(labInstrumentResult.id, row.id));
      await this.audit.record(tx, actor, {
        action: "lab.instrument.result.dismiss",
        resourceType: "lab_instrument_result",
        resourceId: row.id,
        patientId: row.patientId ?? undefined,
        reason,
      });
      return { id: row.id, state: "dismissed" as const };
    });
  }

  // ---- helpers --------------------------------------------------------------------------------------------------

  private async instrument(executor: DbExecutor, organizationId: string, instrumentId: string) {
    const [row] = await executor
      .select()
      .from(labInstrument)
      .where(and(eq(labInstrument.organizationId, organizationId), eq(labInstrument.id, instrumentId)));
    return found(row, "Instrument");
  }

  private async lockPending(tx: DbExecutor, organizationId: string, facilityId: string, id: string): Promise<LabInstrumentResultRecord> {
    const [row] = await tx
      .select()
      .from(labInstrumentResult)
      .where(and(eq(labInstrumentResult.organizationId, organizationId), eq(labInstrumentResult.id, id)))
      .for("update");
    if (!row || row.facilityId !== facilityId) throw new NotFoundError("Instrument result");
    if (row.state !== "pending") throw new BusinessRuleError("This instrument result was already decided", "instrument_result_decided");
    return row;
  }

  private async match(
    tx: DbExecutor,
    organizationId: string,
    instrumentId: string,
    facilityId: string,
    result: InstrumentReadResult,
  ): Promise<{
    problem: InstrumentMatchProblem | null;
    patientId: string | null;
    specimenId: string | null;
    orderItemId: string | null;
    testId: string | null;
  }> {
    const none = { patientId: null, specimenId: null, orderItemId: null, testId: null };
    if (!result.specimenCode) return { problem: "no_specimen_id", ...none };
    const [specimen] = await tx
      .select({ id: labSpecimen.id, patientId: labSpecimen.patientId })
      .from(labSpecimen)
      .where(and(eq(labSpecimen.organizationId, organizationId), eq(labSpecimen.facilityId, facilityId), eq(labSpecimen.accessionNumber, result.specimenCode)));
    if (!specimen) return { problem: "unknown_specimen", ...none };
    const withSpecimen = { patientId: specimen.patientId, specimenId: specimen.id, orderItemId: null };
    if (!result.analyzerCode) return { problem: "no_test_code", ...withSpecimen, testId: null };
    const [mapping] = await tx
      .select({ testId: labInstrumentTestCode.testId })
      .from(labInstrumentTestCode)
      .where(and(eq(labInstrumentTestCode.instrumentId, instrumentId), eq(labInstrumentTestCode.analyzerCode, result.analyzerCode)));
    if (!mapping) return { problem: "unmapped_code", ...withSpecimen, testId: null };
    const [item] = await tx
      .select({ id: labOrderItem.id })
      .from(labOrderItem)
      .where(and(eq(labOrderItem.specimenId, specimen.id), eq(labOrderItem.testId, mapping.testId), ne(labOrderItem.status, "cancelled")));
    if (!item) return { problem: "test_not_ordered", ...withSpecimen, testId: mapping.testId };
    return { problem: null, patientId: specimen.patientId, specimenId: specimen.id, orderItemId: item.id, testId: mapping.testId };
  }
}
