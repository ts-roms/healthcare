import { Injectable } from "@nestjs/common";
import { AuditAssistantQueries, UNUSUAL_ACCESS_RULE, unusualAccessSuggestions } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
import {
  BillingAssistantQueries,
  DUPLICATE_INVOICE_RULE,
  duplicateInvoiceSuggestions,
  UNCHARGED_WORK_RULE,
  unchargedWorkSuggestions,
  type UnchargedWorkInput,
} from "@healthcare/billing";
import {
  ClinicAssistantQueries,
  CODE_SUGGESTIONS_RULE,
  codeSuggestions,
  ENCOUNTER_CHECKLIST_RULE,
  EncounterAssistantQueries,
  encounterChecklistSuggestions,
  NO_SHOW_RISK_RULE,
  noShowRiskSuggestions,
  QUEUE_WAIT_RULE,
  queueWaitSuggestions,
} from "@healthcare/clinic";
import { type Actor, localDate, NotFoundError, PH_TIMEZONE, type RuleDefinition, type Suggestion } from "@healthcare/core";
import {
  AUDIENCE_IDEAS_RULE,
  audienceIdeas,
  audienceIdeaSuggestions,
  CrmAssistantQueries,
  FREQUENCY_LOAD_RULE,
  frequencyLoadSuggestions,
  SEND_HOUR_RULE,
  sendHourSuggestions,
} from "@healthcare/crm";
import {
  CHART_CONSISTENCY_RULE,
  chartConsistencySuggestions,
  DentalAssistantQueries,
  type DentalPlanInput,
  PLAN_DECISIONS_RULE,
  planDecisionSuggestions,
} from "@healthcare/dental";
import {
  DAYS_OF_COVER_RULE,
  daysOfCoverSuggestions,
  EXPIRY_EXPOSURE_RULE,
  expiryExposureSuggestions,
  InventoryAssistantQueries,
  type LocatedLot,
  USAGE_SPIKE_RULE,
  usageSpikeSuggestions,
} from "@healthcare/inventory";
import {
  DELTA_CHECK_RULE,
  deltaCheckSuggestions,
  LabAssistantQueries,
  LabOrderSetService,
  MONITORING_GAP_RULE,
  monitoringGapSuggestions,
  type OrderSetCandidate,
  ORDER_SETS_RULE,
  orderSetSuggestions,
  QC_TREND_RULE,
  qcTrendSuggestions,
  REJECTION_RATE_RULE,
  rejectionRateSuggestions,
  TURNAROUND_RISK_RULE,
  turnaroundRiskSuggestions,
} from "@healthcare/laboratory";
import { COMPLIANCE_GAPS_RULE, complianceGapsSuggestions, OrganizationAssistantQueries } from "@healthcare/organization";
import {
  CHECK_PROMPTS_RULE,
  checkPromptSuggestions,
  COURSE_EXPIRY_RULE,
  courseExpirySuggestions,
  DISPENSABLE_CATEGORIES,
  DOSE_LIMIT_RULE,
  doseLimitSuggestions,
  type DraftMedicine,
  DUPLICATE_THERAPY_RULE,
  duplicateTherapySuggestions,
  type PrescribingCheck,
  PrescriptionAssistantQueries,
  SHORT_STOCK_RULE,
  shortStockSuggestions,
  type StockCandidate,
  stockCandidates,
} from "@healthcare/prescription";
import { IN_PERSON_RULE, inPersonSuggestions, TelemedicineAssistantQueries } from "@healthcare/telemedicine";

/** When a rule reads its figures: now for a screen, a past moment when the settings screen replays it. */
export interface RuleMoment {
  asOf: Date;
  /** The facility's local day the rule is about (YYYY-MM-DD): today, or the day the appointments screen shows. */
  date: string;
  /** That day's bounds in the facility's time zone. */
  dayStart: Date;
  dayEnd: Date;
  /** The facility's local date at `asOf`. */
  today: string;
  timeZone: string;
  /** A live request (a past moment cannot read what was on open orders then). */
  live: boolean;
  /** The consultation a consultation screen shows; a replay reads every consultation open at the moment instead. */
  encounterId?: string;
  /** The patient a patient screen shows (the dental record); a replay reads every patient with an open plan at the facility. */
  patientId?: string;
  /** The prescription the dispense screen shows; a replay reads the dispenses of the day instead. */
  prescriptionId?: string;
  /** A prescription being drafted (surface `prescribing`); a replay reads the prescriptions issued that day instead. */
  prescriptionDraft?: PrescriptionDraft;
}

/** A prescription as the prescriber is writing it, checked before it is issued. */
export interface PrescriptionDraft {
  encounterId: string;
  medicines: DraftMedicine[];
  /** The prescription being replaced, left out of the patient's earlier ones. */
  replacesPrescriptionId?: string;
}

/**
 * A rule with the means to load what it reads. Rules are pure and live in their domain; this is where the API, the
 * composition root, connects them to each domain's read queries (docs/architecture/heuristic-assistant.md).
 */
export interface RuleBinding {
  definition: RuleDefinition<unknown>;
  /** The facility's local time a replay reads each past day at (the moment the rule's screen is most often open). */
  replayAt: string;
  /** `parameters` is the stored setting, checked against the rule's schema by the service before it runs. */
  run(actor: Actor, facilityId: string, parameters: unknown, moment: RuleMoment): Promise<Suggestion[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The stock a dispense took, as the course check's candidates: per location and item, with its lots. */
function dispensedFrom(prescriptionItemId: string, lots: readonly LocatedLot[]): StockCandidate[] {
  const byPlace = new Map<string, StockCandidate>();
  for (const lot of lots) {
    const key = `${lot.locationId}:${lot.itemId}`;
    const candidate = byPlace.get(key) ?? {
      prescriptionItemId,
      locationId: lot.locationId,
      locationName: lot.locationName,
      itemId: lot.itemId,
      itemName: lot.itemName,
      lots: [],
    };
    candidate.lots.push({ lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, quantity: lot.quantity });
    byPlace.set(key, candidate);
  }
  return [...byPlace.values()];
}

/** A definition's parameters are typed in its own module; the binding parses them back through its schema. */
function erase<P>(definition: RuleDefinition<P>): RuleDefinition<unknown> {
  return definition as RuleDefinition<unknown>;
}

@Injectable()
export class AssistantRules {
  readonly bindings: readonly RuleBinding[];

  constructor(
    inventory: InventoryAssistantQueries,
    billing: BillingAssistantQueries,
    clinic: ClinicAssistantQueries,
    dental: DentalAssistantQueries,
    encounters: EncounterAssistantQueries,
    lab: LabAssistantQueries,
    audit: AuditAssistantQueries,
    organization: OrganizationAssistantQueries,
    users: UsersService,
    orderSets: LabOrderSetService,
    crm: CrmAssistantQueries,
    prescriptions: PrescriptionAssistantQueries,
    telemedicine: TelemedicineAssistantQueries,
  ) {
    /** The consultations a consultation rule reads: the one on screen, none on a live request without one, every one open in a replay. */
    const encountersFor = async (actor: Actor, facilityId: string, moment: RuleMoment): Promise<string[]> => {
      if (moment.encounterId) return [moment.encounterId];
      if (moment.live) return [];
      return encounters.openOn(actor.organizationId, facilityId, moment.dayStart, moment.asOf);
    };
    /**
     * What the prescribing rules check: the draft on screen against the patient's earlier prescriptions, or, in a replay,
     * each prescription issued at the facility that day as it was written, against what was on record when it was issued.
     * Read once per moment for the three rules.
     */
    const prescribingChecks = async (actor: Actor, facilityId: string, moment: RuleMoment): Promise<PrescribingCheck[]> => {
      const org = actor.organizationId;
      const draft = moment.prescriptionDraft;
      if (draft) {
        const consultation = await prescriptions.consultation(org, draft.encounterId);
        if (!consultation) throw new NotFoundError("Encounter");
        const earlier = await prescriptions.earlierPrescriptions(org, consultation.patientId, moment.asOf, draft.replacesPrescriptionId);
        const settings = await prescriptions.settings(org);
        return [
          {
            encounterId: draft.encounterId,
            asOf: moment.asOf.toISOString(),
            timeZone: moment.timeZone,
            patient: consultation.patient,
            medicines: draft.medicines,
            earlier,
            settings,
          },
        ];
      }
      if (moment.live) return [];
      const issued = await prescriptions.issuedBetween(org, facilityId, moment.dayStart, moment.asOf);
      if (issued.length === 0) return [];
      const settings = await prescriptions.settings(org);
      const checks: PrescribingCheck[] = [];
      for (const p of issued) {
        const consultation = await prescriptions.consultation(org, p.encounterId);
        const earlier = await prescriptions.earlierPrescriptions(org, p.patientId, p.issuedAt, p.replacesPrescriptionId ?? undefined);
        checks.push({
          encounterId: p.encounterId,
          asOf: p.issuedAt.toISOString(),
          timeZone: moment.timeZone,
          patient: consultation?.patient ?? { sex: null, age: null },
          medicines: p.medicines,
          earlier,
          settings,
        });
      }
      return checks;
    };
    /** The organization's active order sets, each item with the tests it orders (a panel's members). */
    const activeOrderSets = async (actor: Actor): Promise<OrderSetCandidate[]> =>
      (await orderSets.list(actor.organizationId)).map((set) => ({
        id: set.id,
        name: set.name,
        note: set.note,
        items: set.items.filter((i) => i.status === "active").map((i) => ({ name: i.name, testIds: i.testIds })),
        triggers: set.triggers,
      }));
    /** What the dental rules read: the patient on screen, or every patient with an open plan at the facility in a replay. Once per moment. */
    const plansRead = new WeakMap<RuleMoment, Promise<DentalPlanInput[]>>();
    const dentalPlansFor = (actor: Actor, facilityId: string, moment: RuleMoment): Promise<DentalPlanInput[]> => {
      let pending = plansRead.get(moment);
      if (!pending) {
        pending =
          moment.patientId || !moment.live
            ? dental.planInputs(actor.organizationId, { facilityId, asOf: moment.asOf, patientIds: moment.patientId ? [moment.patientId] : undefined })
            : Promise.resolve([]);
        plansRead.set(moment, pending);
      }
      return pending;
    };
    const checksRead = new WeakMap<RuleMoment, Promise<PrescribingCheck[]>>();
    const prescribingChecksFor = (actor: Actor, facilityId: string, moment: RuleMoment): Promise<PrescribingCheck[]> => {
      let pending = checksRead.get(moment);
      if (!pending) {
        pending = prescribingChecks(actor, facilityId, moment);
        checksRead.set(moment, pending);
      }
      return pending;
    };
    this.bindings = [
      {
        definition: erase(DAYS_OF_COVER_RULE),
        replayAt: "08:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = DAYS_OF_COVER_RULE.parametersSchema.parse(raw);
          const since = new Date(moment.asOf.getTime() - params.windowDays * DAY_MS);
          return daysOfCoverSuggestions(await inventory.coverInputs(actor.organizationId, facilityId, since, moment), params);
        },
      },
      {
        definition: erase(USAGE_SPIKE_RULE),
        replayAt: "08:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = USAGE_SPIKE_RULE.parametersSchema.parse(raw);
          return usageSpikeSuggestions(await inventory.weeklyIssues(actor.organizationId, facilityId, params.weeks, moment), params);
        },
      },
      {
        definition: erase(EXPIRY_EXPOSURE_RULE),
        replayAt: "08:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = EXPIRY_EXPOSURE_RULE.parametersSchema.parse(raw);
          const since = new Date(moment.asOf.getTime() - params.windowDays * DAY_MS);
          return expiryExposureSuggestions(await inventory.expiryInputs(actor.organizationId, facilityId, since, moment), params, moment.today);
        },
      },
      {
        definition: erase(UNCHARGED_WORK_RULE),
        replayAt: "17:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = UNCHARGED_WORK_RULE.parametersSchema.parse(raw);
          const from = new Date(moment.asOf.getTime() - params.lookbackDays * DAY_MS);
          const to = new Date(moment.asOf.getTime() - params.delayHours * HOUR_MS);
          const org = actor.organizationId;
          // Clinical work from the clinical domains, then billing's state of each: billing never reads clinical tables.
          const clinicWork = await clinic.proceduresPerformed(org, facilityId, from, to, moment.asOf);
          const dentalWork = await dental.proceduresPerformed(org, facilityId, from, to, moment.asOf);
          const work = [
            ...clinicWork.map((p) => ({ kind: "clinic_procedure" as const, ...p })),
            ...dentalWork.map((p) => ({ kind: "dental_procedure" as const, ...p })),
          ].map((p) => ({ kind: p.kind, sourceId: p.id, code: p.code, name: p.name, serviceDate: localDate(p.performedAt, moment.timeZone) }));
          const states = await billing.chargeStates(org, work, moment.asOf);
          const inputs: UnchargedWorkInput[] = work.map((w) => {
            const state = states.get(`${w.kind}:${w.sourceId}`);
            return { ...w, charged: state?.charged ?? false, mapped: state?.mapped ?? false, priced: state?.priced ?? false };
          });
          return unchargedWorkSuggestions(inputs, params);
        },
      },
      {
        definition: erase(NO_SHOW_RISK_RULE),
        replayAt: "07:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = NO_SHOW_RISK_RULE.parametersSchema.parse(raw);
          const inputs = await clinic.noShowInputs(actor.organizationId, facilityId, {
            dayStart: moment.dayStart,
            dayEnd: moment.dayEnd,
            date: moment.date,
            asOf: moment.asOf,
            historyDays: params.historyDays,
          });
          return noShowRiskSuggestions(inputs, params, moment.timeZone);
        },
      },
      {
        definition: erase(QUEUE_WAIT_RULE),
        replayAt: "10:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = QUEUE_WAIT_RULE.parametersSchema.parse(raw);
          const inputs = await clinic.queueWaitInputs(actor.organizationId, facilityId, {
            date: moment.today,
            asOf: moment.asOf,
            historyDays: params.historyDays,
          });
          return queueWaitSuggestions(inputs, params, moment.today);
        },
      },
      {
        definition: erase(ENCOUNTER_CHECKLIST_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = ENCOUNTER_CHECKLIST_RULE.parametersSchema.parse(raw);
          const out: Suggestion[] = [];
          for (const id of await encountersFor(actor, facilityId, moment)) {
            const input = await encounters.checklistInput(actor.organizationId, id, moment.asOf, params.vitalsWithinHours);
            out.push(...encounterChecklistSuggestions(input, params));
          }
          return out;
        },
      },
      {
        definition: erase(CODE_SUGGESTIONS_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = CODE_SUGGESTIONS_RULE.parametersSchema.parse(raw);
          const ids = await encountersFor(actor, facilityId, moment);
          if (ids.length === 0) return [];
          const codes = await encounters.usedCodes(actor.organizationId, moment.asOf, params.lookbackDays);
          const out: Suggestion[] = [];
          for (const id of ids) out.push(...codeSuggestions(await encounters.codeTargets(actor.organizationId, id, moment.asOf), codes, params));
          return out;
        },
      },
      {
        definition: erase(DELTA_CHECK_RULE),
        replayAt: "15:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = DELTA_CHECK_RULE.parametersSchema.parse(raw);
          return deltaCheckSuggestions(await lab.deltaInputs(actor.organizationId, facilityId, moment.asOf, params.lookbackDays), params);
        },
      },
      // The laboratory's timing (workbench) and quality (QC page): times, z-scores and counts, never a patient.
      {
        definition: erase(TURNAROUND_RISK_RULE),
        replayAt: "15:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = TURNAROUND_RISK_RULE.parametersSchema.parse(raw);
          const input = await lab.turnaroundInputs(actor.organizationId, facilityId, { asOf: moment.asOf, lookbackDays: params.lookbackDays });
          return turnaroundRiskSuggestions(input, params, moment.asOf.toISOString(), moment.today);
        },
      },
      {
        definition: erase(QC_TREND_RULE),
        replayAt: "10:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = QC_TREND_RULE.parametersSchema.parse(raw);
          const series = await lab.qcSeries(actor.organizationId, facilityId, {
            asOf: moment.asOf,
            lookbackDays: params.lookbackDays,
            maxRuns: Math.max(params.trendRuns, params.shiftRuns),
          });
          return qcTrendSuggestions(series, params, moment.timeZone);
        },
      },
      {
        definition: erase(REJECTION_RATE_RULE),
        replayAt: "17:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = REJECTION_RATE_RULE.parametersSchema.parse(raw);
          const figures = await lab.rejectionFigures(actor.organizationId, facilityId, { asOf: moment.asOf, windowDays: params.windowDays });
          if (figures.collectors.length === 0) return [];
          const names = await users.displayNames(
            actor.organizationId,
            figures.collectors.map((c) => c.userId),
          );
          const collectors = figures.collectors.map((c) => ({ ...c, displayName: names.get(c.userId) ?? "A staff account" }));
          return rejectionRateSuggestions({ collectors, others: figures.others }, params);
        },
      },
      {
        definition: erase(ORDER_SETS_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = ORDER_SETS_RULE.parametersSchema.parse(raw);
          const ids = await encountersFor(actor, facilityId, moment);
          if (ids.length === 0) return [];
          const sets = await activeOrderSets(actor);
          if (!sets.some((s) => s.triggers.length > 0)) return [];
          const out: Suggestion[] = [];
          for (const id of ids) {
            const clinical = await encounters.orderSetContext(actor.organizationId, id, moment.asOf);
            if (!clinical) continue;
            const orderedTestIds = await lab.orderedTestIds(actor.organizationId, id, moment.asOf);
            out.push(...orderSetSuggestions(sets, { encounterId: id, ...clinical, orderedTestIds }, params));
          }
          return out;
        },
      },
      {
        definition: erase(MONITORING_GAP_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = MONITORING_GAP_RULE.parametersSchema.parse(raw);
          const ids = await encountersFor(actor, facilityId, moment);
          if (ids.length === 0) return [];
          const sets = (await activeOrderSets(actor)).filter((s) => s.triggers.some((t) => t.kind === "diagnosis_code"));
          if (sets.length === 0) return [];
          const testIds = [...new Set(sets.flatMap((s) => s.items.flatMap((i) => i.testIds)))];
          const out: Suggestion[] = [];
          for (const id of ids) {
            // The chronic problems from the clinic, the releases and this consultation's orders from the laboratory.
            const record = await encounters.chronicProblems(actor.organizationId, id, moment.asOf);
            if (!record || record.problems.length === 0) continue;
            const lastReleased = await lab.lastReleases(actor.organizationId, record.patientId, testIds, moment.asOf);
            const orderedTestIds = await lab.orderedTestIds(actor.organizationId, id, moment.asOf);
            out.push(
              ...monitoringGapSuggestions(
                { encounterId: id, asOf: moment.asOf.toISOString(), timeZone: moment.timeZone, problems: record.problems, sets, lastReleased, orderedTestIds },
                params,
              ),
            );
          }
          return out;
        },
      },
      // Dental: on the patient's dental record; a replay reads the patients with an open plan at the facility.
      {
        definition: erase(CHART_CONSISTENCY_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, _raw, moment) =>
          (await dentalPlansFor(actor, facilityId, moment)).flatMap((input) => chartConsistencySuggestions(input, moment.timeZone)),
      },
      {
        definition: erase(PLAN_DECISIONS_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = PLAN_DECISIONS_RULE.parametersSchema.parse(raw);
          const asOf = moment.asOf.toISOString();
          return (await dentalPlansFor(actor, facilityId, moment)).flatMap((input) => planDecisionSuggestions(input, params, asOf, moment.timeZone));
        },
      },
      {
        definition: erase(UNUSUAL_ACCESS_RULE),
        replayAt: "21:00",
        run: async (actor, _facilityId, raw, moment) => {
          const params = UNUSUAL_ACCESS_RULE.parametersSchema.parse(raw);
          // The whole organization's trail: an account may work at several facilities. Working hours in this facility's time zone.
          const figures = await audit.accessFigures(actor.organizationId, {
            asOf: moment.asOf,
            windowHours: params.windowHours,
            historyDays: 28,
            timeZone: moment.timeZone,
            workStartHour: params.workStartHour,
            workEndHour: params.workEndHour,
          });
          if (figures.length === 0) return [];
          const names = await users.displayNames(
            actor.organizationId,
            figures.map((f) => f.userId),
          );
          const inputs = figures.map((f) => ({ ...f, displayName: names.get(f.userId) ?? "A staff account" }));
          return unusualAccessSuggestions(inputs, params, moment.today);
        },
      },
      {
        definition: erase(COMPLIANCE_GAPS_RULE),
        replayAt: "09:00",
        run: async (actor, _facilityId, raw, moment) => {
          const params = COMPLIANCE_GAPS_RULE.parametersSchema.parse(raw);
          return complianceGapsSuggestions(await organization.complianceAreas(actor.organizationId, moment.asOf), params, moment.today);
        },
      },
      {
        definition: erase(DUPLICATE_INVOICE_RULE),
        replayAt: "17:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = DUPLICATE_INVOICE_RULE.parametersSchema.parse(raw);
          const pairs = await billing.duplicatePairs(actor.organizationId, facilityId, {
            asOf: moment.asOf,
            lookbackDays: params.lookbackDays,
            withinHours: params.withinHours,
          });
          return duplicateInvoiceSuggestions(pairs, moment.timeZone);
        },
      },
      // Outreach is organization-wide and its times are Asia/Manila time (quiet hours, send times), whatever the facility's zone.
      {
        definition: erase(SEND_HOUR_RULE),
        replayAt: "10:00",
        run: async (actor, _facilityId, raw, moment) => {
          const params = SEND_HOUR_RULE.parametersSchema.parse(raw);
          const org = actor.organizationId;
          const hourly = await audit.portalVisitsByHour(org, { asOf: moment.asOf, lookbackDays: params.lookbackDays, timeZone: PH_TIMEZONE });
          const { quietHours } = await crm.limits(org);
          const recentSendHours = await crm.recentSendHours(org, moment.asOf);
          return sendHourSuggestions({ hourly, quietHours, recentSendHours }, params);
        },
      },
      {
        definition: erase(AUDIENCE_IDEAS_RULE),
        replayAt: "10:00",
        run: async (actor, _facilityId, raw, moment) => {
          const params = AUDIENCE_IDEAS_RULE.parametersSchema.parse(raw);
          const org = actor.organizationId;
          const today = localDate(moment.asOf, PH_TIMEZONE);
          // Return gaps from the clinic over two years; patient counts through the same matching a segment preview does.
          const returns = await clinic.returnFigures(org, { asOf: moment.asOf, lookbackDays: 730, fraction: params.returnPercentile / 100 });
          const ideas = audienceIdeas({ today, returns, segments: await crm.activeSegmentCriteria(org, moment.asOf) }, params);
          const counted = [];
          for (const idea of ideas) counted.push({ ...idea, patients: await crm.countMatching(org, idea.criteria, today) });
          return audienceIdeaSuggestions(counted, params);
        },
      },
      {
        definition: erase(FREQUENCY_LOAD_RULE),
        replayAt: "10:00",
        run: async (actor, _facilityId, raw, moment) => {
          const params = FREQUENCY_LOAD_RULE.parametersSchema.parse(raw);
          const load = await crm.outreachLoad(actor.organizationId, { asOf: moment.asOf, windowDays: params.windowDays, campaigns: params.campaigns });
          const { cap } = await crm.limits(actor.organizationId);
          return frequencyLoadSuggestions({ ...load, cap }, params);
        },
      },
      {
        definition: erase(IN_PERSON_RULE),
        replayAt: "16:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = IN_PERSON_RULE.parametersSchema.parse(raw);
          const org = actor.organizationId;
          const onlineSince = new Date(moment.asOf.getTime() - params.onlineDays * DAY_MS);
          const out: Suggestion[] = [];
          for (const id of await encountersFor(actor, facilityId, moment)) {
            // Online consultations only: the patient's care from the clinic, the pre-consult answers from telemedicine.
            const care = await encounters.careContinuity(org, id, { asOf: moment.asOf, onlineSince });
            if (!care?.online) continue;
            const answers = await telemedicine.preConsultAnswers(org, id, moment.asOf);
            out.push(
              ...inPersonSuggestions(
                {
                  encounterId: id,
                  asOf: moment.asOf.toISOString(),
                  timeZone: moment.timeZone,
                  redFlags: answers?.redFlags ?? [],
                  symptomDurationDays: answers?.symptomDurationDays ?? null,
                  onlineConsultations: care.onlineConsultations,
                  lastInPersonAt: care.lastInPersonAt,
                  lastVitalsAt: care.lastVitalsAt,
                },
                params,
              ),
            );
          }
          return out;
        },
      },
      // Pharmacy: the waiting prescriptions on its home, a prescription on the dispense screen. Stock from inventory, in the
      // dispensing workflow's own categories.
      {
        definition: erase(SHORT_STOCK_RULE),
        replayAt: "09:00",
        run: async (actor, facilityId, raw, moment) => {
          if (moment.prescriptionId) return [];
          const params = SHORT_STOCK_RULE.parametersSchema.parse(raw);
          const since = new Date(moment.asOf.getTime() - params.withinDays * DAY_MS);
          const pending = await prescriptions.pendingItems(actor.organizationId, facilityId, { since, asOf: moment.asOf });
          if (pending.length === 0) return [];
          const stocked = await inventory.stockedItems(actor.organizationId, facilityId, DISPENSABLE_CATEGORIES, moment.asOf);
          if (stocked.length === 0) return [];
          const lots = await inventory.usableLots(actor.organizationId, facilityId, DISPENSABLE_CATEGORIES, moment);
          return shortStockSuggestions({ pending, stocked, lots }, params, moment.timeZone);
        },
      },
      {
        definition: erase(COURSE_EXPIRY_RULE),
        replayAt: "17:00",
        run: async (actor, facilityId, raw, moment) => {
          const params = COURSE_EXPIRY_RULE.parametersSchema.parse(raw);
          const org = actor.organizationId;
          if (moment.prescriptionId) {
            const rx = await prescriptions.dispensingItems(org, moment.prescriptionId, moment.asOf);
            if (!rx) return [];
            const lots = await inventory.usableLots(org, facilityId, DISPENSABLE_CATEGORIES, moment);
            return courseExpirySuggestions({ ...rx, day: moment.today, candidates: stockCandidates(rx.items, lots) }, params);
          }
          if (moment.live) return [];
          // A replay checks what each dispense of the day handed over: the lots it took, against its course.
          const dispenses = await prescriptions.dispensesBetween(org, facilityId, moment.dayStart, moment.asOf);
          const taken = await inventory.lotsTaken(
            org,
            dispenses.map((d) => d.movementGroupId),
          );
          return dispenses.flatMap((d) =>
            courseExpirySuggestions(
              {
                prescriptionId: d.prescriptionId,
                prescriptionNumber: d.prescriptionNumber,
                day: localDate(d.dispensedAt, moment.timeZone),
                items: [d.item],
                // One dispense takes from one location and item: its lots together, the earliest expiry first.
                candidates: dispensedFrom(d.item.prescriptionItemId, taken.get(d.movementGroupId) ?? []),
              },
              params,
            ),
          );
        },
      },
      // Prescribing: checked in the prescribing dialog before issuing; a replay reads the whole day's prescriptions.
      {
        definition: erase(DUPLICATE_THERAPY_RULE),
        replayAt: "23:59",
        run: async (actor, facilityId, raw, moment) => {
          const params = DUPLICATE_THERAPY_RULE.parametersSchema.parse(raw);
          return (await prescribingChecksFor(actor, facilityId, moment)).flatMap((check) => duplicateTherapySuggestions(check, params));
        },
      },
      {
        definition: erase(DOSE_LIMIT_RULE),
        replayAt: "23:59",
        run: async (actor, facilityId, raw, moment) => {
          const params = DOSE_LIMIT_RULE.parametersSchema.parse(raw);
          return (await prescribingChecksFor(actor, facilityId, moment)).flatMap((check) => doseLimitSuggestions(check, params));
        },
      },
      {
        definition: erase(CHECK_PROMPTS_RULE),
        replayAt: "23:59",
        run: async (actor, facilityId, raw, moment) => {
          const params = CHECK_PROMPTS_RULE.parametersSchema.parse(raw);
          return (await prescribingChecksFor(actor, facilityId, moment)).flatMap((check) => checkPromptSuggestions(check, params));
        },
      },
    ];
  }

  find(ruleId: string): RuleBinding | undefined {
    return this.bindings.find((b) => b.definition.id === ruleId);
  }
}
