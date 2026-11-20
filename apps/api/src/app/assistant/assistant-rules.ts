import { Injectable } from "@nestjs/common";
import { BillingAssistantQueries, UNCHARGED_WORK_RULE, unchargedWorkSuggestions, type UnchargedWorkInput } from "@healthcare/billing";
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
import { type Actor, localDate, type RuleDefinition, type Suggestion } from "@healthcare/core";
import { DentalAssistantQueries } from "@healthcare/dental";
import {
  DAYS_OF_COVER_RULE,
  daysOfCoverSuggestions,
  EXPIRY_EXPOSURE_RULE,
  expiryExposureSuggestions,
  InventoryAssistantQueries,
  USAGE_SPIKE_RULE,
  usageSpikeSuggestions,
} from "@healthcare/inventory";
import { DELTA_CHECK_RULE, deltaCheckSuggestions, LabAssistantQueries } from "@healthcare/laboratory";

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
  ) {
    /** The consultations a consultation rule reads: the one on screen, none on a live request without one, every one open in a replay. */
    const encountersFor = async (actor: Actor, facilityId: string, moment: RuleMoment): Promise<string[]> => {
      if (moment.encounterId) return [moment.encounterId];
      if (moment.live) return [];
      return encounters.openOn(actor.organizationId, facilityId, moment.dayStart, moment.asOf);
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
    ];
  }

  find(ruleId: string): RuleBinding | undefined {
    return this.bindings.find((b) => b.definition.id === ruleId);
  }
}
