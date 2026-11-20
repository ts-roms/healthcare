import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  localDate,
  localDayBounds,
  NotFoundError,
  parseSuggestionId,
  PgErrorCode,
  requireFacilityId,
  type RuleParameterLabel,
  type Suggestion,
  type SuggestionSurface,
  VersionConflictError,
  zonedToUtc,
} from "@healthcare/core";
import { facility } from "@healthcare/organization";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { AssistantRules, type RuleBinding, type RuleMoment } from "./assistant-rules";
import { assistantFeedback, assistantRuleSetting, type AssistantOutcome } from "./assistant.schema";

/** A dismissed suggestion stays hidden from the person who dismissed it for this long; the same finding may then return. */
export const DISMISSAL_DAYS = 14;

/** The most suggestions one request returns. */
const MAX_SUGGESTIONS = 20;

/** The most past days one replay reads. */
export const MAX_REPLAY_DAYS = 31;

export interface ReplayAnswer {
  ruleId: string;
  facilityId: string;
  /** The facility's local time each day was read at. */
  readAt: string;
  days: Array<{ date: string; suggestions: number; weak: number }>;
  /** Suggestions a day on average over the days read. */
  averagePerDay: number;
  maxPerDay: number;
  /** What a replay cannot know (e.g. open orders on a past day), in plain words. */
  notes: string[];
}

type SettingRow = typeof assistantRuleSetting.$inferSelect;

export interface SuggestionsAnswer {
  items: Suggestion[];
  /** Hidden because this person dismissed them recently. */
  dismissed: number;
  /** Rules turned on here whose suggestions need a permission the caller lacks ("Not available to you"); no counts. */
  withheld: Array<{ ruleId: string; title: string }>;
}

/**
 * The heuristic assistant (docs/architecture/heuristic-assistant.md, ADR-0018): which rules an organization or facility
 * turned on, the suggestions they produce for the caller, and what staff did with them. Suggestions are computed on
 * demand and never stored; the assistant writes nothing clinical and its only action is a link.
 */
@Injectable()
export class AssistantService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly rules: AssistantRules,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- suggestions -------------------------------------------------------------------------------------------------

  /** `date` (YYYY-MM-DD): the day a screen shows (the appointments board); `encounterId`: the consultation a consultation screen shows. */
  async suggestions(actor: Actor, surface: SuggestionSurface, context: { date?: string; encounterId?: string } = {}): Promise<SuggestionsAnswer> {
    const facilityId = requireFacilityId(actor);
    const timeZone = await this.facilityTimeZone(actor, facilityId);
    const moment = { ...liveMoment(timeZone, context.date), encounterId: context.encounterId };
    const bindings = this.rules.bindings.filter((b) => b.definition.surfaces.includes(surface));
    const settings = await this.effectiveSettings(actor.organizationId, facilityId, bindings);

    const items: Suggestion[] = [];
    const withheld: SuggestionsAnswer["withheld"] = [];
    const ran: string[] = [];
    for (const binding of bindings) {
      const setting = settings.get(binding.definition.id);
      if (!setting?.enabled) continue;
      if (!binding.definition.requires.every((p) => actor.permissions.has(p))) {
        withheld.push({ ruleId: binding.definition.id, title: binding.definition.title });
        continue;
      }
      const parsed = binding.definition.parametersSchema.safeParse(setting.parameters);
      if (!parsed.success) continue; // a stored setting the rule no longer accepts: the rule stays silent until it is saved again
      items.push(...(await binding.run(actor, facilityId, parsed.data, moment)));
      ran.push(binding.definition.id);
    }

    const hidden = await this.recentlyAnswered(actor, items);
    const shown = items.filter((s) => !hidden.has(s.id)).slice(0, MAX_SUGGESTIONS);
    await this.audit.recordStandalone(actor, {
      action: "assistant.view",
      resourceType: "assistant_surface",
      metadata: { surface, rules: ran, shown: shown.length, ...(context.encounterId ? { encounterId: context.encounterId } : {}) },
    });
    return { items: shown, dismissed: items.filter((s) => hidden.has(s.id)).length, withheld };
  }

  /** Records what the caller did with a suggestion. Rejects ids of rules that do not exist. */
  async answer(actor: Actor, suggestionId: string, outcome: AssistantOutcome, reason?: string): Promise<{ id: string }> {
    const facilityId = requireFacilityId(actor);
    const parsed = parseSuggestionId(suggestionId);
    const binding = parsed ? this.rules.find(parsed.ruleId) : undefined;
    if (!parsed || !binding || parsed.ruleVersion > binding.definition.version) throw new NotFoundError("Suggestion");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(assistantFeedback)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          userId: actor.userId,
          ruleId: parsed.ruleId,
          ruleVersion: parsed.ruleVersion,
          subjectKey: parsed.subjectKey,
          outcome,
          reason: reason ?? null,
        })
        .returning({ id: assistantFeedback.id });
      await this.audit.record(tx, actor, {
        action: "assistant.answer",
        resourceType: "assistant_rule",
        metadata: { ruleId: parsed.ruleId, ruleVersion: parsed.ruleVersion, outcome },
      });
      await this.events.record(tx, {
        type: "AssistantSuggestionActedOn",
        organizationId: actor.organizationId,
        aggregateType: "assistant_feedback",
        aggregateId: row!.id,
        facilityId,
        payload: { ruleId: parsed.ruleId, ruleVersion: parsed.ruleVersion, outcome },
      });
      return { id: row!.id };
    });
  }

  // ---- settings ----------------------------------------------------------------------------------------------------

  /** Every rule with the setting in force for one scope (the organization, or one facility). */
  async ruleSettings(actor: Actor, facilityId?: string) {
    const scope = facilityId ?? null;
    if (scope) await this.assertFacility(actor, scope);
    const rows = await this.latestInScope(actor.organizationId, scope, this.rules.bindings);
    // For a facility, the organization's setting too: it applies wherever the facility has none of its own.
    const org = scope ? await this.latestInScope(actor.organizationId, null, this.rules.bindings) : rows;
    const view = (row: SettingRow | undefined) =>
      row ? { version: row.version, enabled: row.enabled, parameters: row.parameters, updatedAt: row.updatedAt.toISOString() } : null;
    return this.rules.bindings.map(({ definition }) => ({
      ruleId: definition.id,
      ruleVersion: definition.version,
      domain: definition.domain,
      title: definition.title,
      description: definition.description,
      surfaces: definition.surfaces,
      requires: definition.requires,
      defaultParameters: definition.defaultParameters,
      parameterLabels: definition.parameterLabels as Record<string, RuleParameterLabel>,
      scope: { facilityId: scope },
      setting: view(rows.get(definition.id)),
      organizationSetting: view(org.get(definition.id)),
    }));
  }

  async updateSetting(
    actor: Actor,
    ruleId: string,
    input: { facilityId?: string | null; enabled: boolean; parameters?: Record<string, unknown>; expectedVersion: number },
  ) {
    const binding = this.rules.find(ruleId);
    if (!binding) throw new NotFoundError("Assistant rule");
    const scope = input.facilityId ?? null;
    if (scope) await this.assertFacility(actor, scope);
    const parsed = binding.definition.parametersSchema.safeParse(input.parameters ?? binding.definition.defaultParameters);
    if (!parsed.success) throw this.invalidParameters(binding, parsed.error.issues);
    try {
      return await this.db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ version: assistantRuleSetting.version })
          .from(assistantRuleSetting)
          .where(scopeFilter(actor.organizationId, scope, ruleId))
          .orderBy(desc(assistantRuleSetting.version))
          .limit(1);
        const current = latest?.version ?? 0;
        if (current !== input.expectedVersion) throw new VersionConflictError("Assistant rule setting", input.expectedVersion);
        const [row] = await tx
          .insert(assistantRuleSetting)
          .values({
            organizationId: actor.organizationId,
            facilityId: scope,
            ruleId,
            version: current + 1,
            enabled: input.enabled,
            parameters: parsed.data as Record<string, unknown>,
            updatedBy: actor.userId,
          })
          .returning();
        await this.audit.record(tx, actor, {
          action: "assistant.rule-setting",
          resourceType: "assistant_rule",
          metadata: { ruleId, facilityId: scope, enabled: input.enabled, version: current + 1 },
        });
        return { ruleId, version: row!.version, enabled: row!.enabled, parameters: row!.parameters, facilityId: scope };
      });
    } catch (error) {
      // Two editors saving the same version at once: the unique index lets one win.
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new VersionConflictError("Assistant rule setting", input.expectedVersion);
      throw error;
    }
  }

  // ---- replay ------------------------------------------------------------------------------------------------------

  /**
   * How often a rule would have spoken on each of the last `days` days at a facility, with given (or its stored, else
   * starting) parameters: each day is read at the rule's usual time, from the records as they stood then. Counts only;
   * nothing is stored or shown to anyone else. Audited.
   */
  async replay(actor: Actor, ruleId: string, input: { facilityId?: string | null; parameters?: Record<string, unknown>; days: number }): Promise<ReplayAnswer> {
    const binding = this.rules.find(ruleId);
    if (!binding) throw new NotFoundError("Assistant rule");
    if (!binding.definition.requires.every((p) => actor.permissions.has(p))) {
      throw new ForbiddenError("This rule reads records you do not have access to");
    }
    const facilityId = input.facilityId ?? requireFacilityId(actor);
    const timeZone = await this.facilityTimeZone(actor, facilityId);
    let parameters: unknown = input.parameters;
    if (!parameters) {
      const settings = await this.effectiveSettings(actor.organizationId, facilityId, [binding]);
      parameters = settings.get(ruleId)?.parameters ?? binding.definition.defaultParameters;
    }
    const parsed = binding.definition.parametersSchema.safeParse(parameters);
    if (!parsed.success) throw this.invalidParameters(binding, parsed.error.issues);
    const days = Math.min(MAX_REPLAY_DAYS, Math.max(1, input.days));
    const today = localDate(new Date(), timeZone);
    const out: ReplayAnswer["days"] = [];
    for (let back = days; back >= 1; back--) {
      const date = shiftDay(today, -back);
      const found = await binding.run(actor, facilityId, parsed.data, pastMoment(timeZone, date, binding.replayAt));
      out.push({ date, suggestions: found.length, weak: found.filter((s) => s.strength === "weak").length });
    }
    await this.audit.recordStandalone(actor, {
      action: "assistant.replay",
      resourceType: "assistant_rule",
      metadata: { ruleId, facilityId, days },
    });
    const counts = out.map((d) => d.suggestions);
    return {
      ruleId,
      facilityId,
      readAt: binding.replayAt,
      days: out,
      averagePerDay: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
      maxPerDay: Math.max(...counts),
      notes: binding.definition.id === "inventory.days-of-cover" ? ["Open purchase orders on past days are not known, so none are counted."] : [],
    };
  }

  // ---- insights ----------------------------------------------------------------------------------------------------

  /** How staff answered each rule's suggestions over the last `days` days (counts only). */
  async insights(actor: Actor, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        ruleId: assistantFeedback.ruleId,
        outcome: assistantFeedback.outcome,
        count: sql<number>`count(*)::int`,
      })
      .from(assistantFeedback)
      .where(and(eq(assistantFeedback.organizationId, actor.organizationId), gte(assistantFeedback.createdAt, since)))
      .groupBy(assistantFeedback.ruleId, assistantFeedback.outcome);
    await this.audit.recordStandalone(actor, { action: "assistant.insights.view", resourceType: "assistant_rule", metadata: { days } });
    return {
      days,
      rules: this.rules.bindings.map(({ definition }) => {
        const mine = rows.filter((r) => r.ruleId === definition.id);
        const count = (outcome: AssistantOutcome) => mine.find((r) => r.outcome === outcome)?.count ?? 0;
        const accepted = count("accepted");
        const dismissed = count("dismissed");
        const notUseful = count("not_useful");
        const answered = accepted + dismissed + notUseful;
        return {
          ruleId: definition.id,
          title: definition.title,
          accepted,
          dismissed,
          notUseful,
          answered,
          // Flagged for the administrator to look at, never changed on its own (the sample must be meaningful).
          reviewSuggested: answered >= 20 && (dismissed + notUseful) / answered >= 0.7,
        };
      }),
    };
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  /** The first wrong parameter, named in the settings screen's own words. */
  private invalidParameters(binding: RuleBinding, issues: ReadonlyArray<{ path: PropertyKey[] }>): BusinessRuleError {
    const labels = binding.definition.parameterLabels as Record<string, RuleParameterLabel>;
    const first = issues[0];
    const field = first ? labels[String(first.path[0])] : undefined;
    const message = field
      ? `${field.label}: enter a whole number${field.min !== undefined && field.max !== undefined ? ` from ${field.min} to ${field.max}` : ""}.`
      : "The rule's settings are not valid.";
    return new BusinessRuleError(message, "invalid_rule_parameters", { issues });
  }

  /** The facility's time zone; also proves the facility is the caller's organization's. */
  private async facilityTimeZone(actor: Actor, facilityId: string): Promise<string> {
    const [row] = await this.db
      .select({ timezone: facility.timezone })
      .from(facility)
      .where(and(eq(facility.organizationId, actor.organizationId), eq(facility.id, facilityId)));
    if (!row) throw new NotFoundError("Facility");
    return row.timezone;
  }

  private async assertFacility(actor: Actor, facilityId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: facility.id })
      .from(facility)
      .where(and(eq(facility.organizationId, actor.organizationId), eq(facility.id, facilityId)));
    if (!row) throw new NotFoundError("Facility");
  }

  /** The latest version of each rule's setting in one scope. */
  private async latestInScope(organizationId: string, scope: string | null, bindings: readonly RuleBinding[]): Promise<Map<string, SettingRow>> {
    const ids = bindings.map((b) => b.definition.id);
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(assistantRuleSetting)
      .where(
        and(
          eq(assistantRuleSetting.organizationId, organizationId),
          scope ? eq(assistantRuleSetting.facilityId, scope) : isNull(assistantRuleSetting.facilityId),
          inArray(assistantRuleSetting.ruleId, ids),
        ),
      )
      .orderBy(desc(assistantRuleSetting.version));
    const latest = new Map<string, SettingRow>();
    for (const row of rows) if (!latest.has(row.ruleId)) latest.set(row.ruleId, row);
    return latest;
  }

  /** The facility's own setting where it has one, else the organization's. */
  private async effectiveSettings(organizationId: string, facilityId: string, bindings: readonly RuleBinding[]): Promise<Map<string, SettingRow>> {
    const own = await this.latestInScope(organizationId, facilityId, bindings);
    const org = await this.latestInScope(organizationId, null, bindings);
    return new Map([...org, ...own]);
  }

  /** Suggestion ids this person dismissed (or called not useful) within `DISMISSAL_DAYS`. */
  private async recentlyAnswered(actor: Actor, suggestions: readonly Suggestion[]): Promise<Set<string>> {
    if (suggestions.length === 0) return new Set();
    const since = new Date(Date.now() - DISMISSAL_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ ruleId: assistantFeedback.ruleId, ruleVersion: assistantFeedback.ruleVersion, subjectKey: assistantFeedback.subjectKey })
      .from(assistantFeedback)
      .where(
        and(
          eq(assistantFeedback.organizationId, actor.organizationId),
          eq(assistantFeedback.userId, actor.userId),
          gte(assistantFeedback.createdAt, since),
          or(eq(assistantFeedback.outcome, "dismissed"), eq(assistantFeedback.outcome, "not_useful")),
        ),
      );
    const answered = new Set(rows.map((r) => `${r.ruleId}@${r.ruleVersion}:${r.subjectKey}`));
    return new Set(suggestions.filter((s) => answered.has(s.id)).map((s) => s.id));
  }
}

function scopeFilter(organizationId: string, scope: string | null, ruleId: string) {
  return and(
    eq(assistantRuleSetting.organizationId, organizationId),
    eq(assistantRuleSetting.ruleId, ruleId),
    scope ? eq(assistantRuleSetting.facilityId, scope) : isNull(assistantRuleSetting.facilityId),
  );
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Now, for a screen showing `date` (default: the facility's today). */
function liveMoment(timeZone: string, date?: string): RuleMoment {
  const asOf = new Date();
  const today = localDate(asOf, timeZone);
  const day = date ?? today;
  const { start, end } = localDayBounds(day, timeZone);
  return { asOf, date: day, dayStart: start, dayEnd: end, today, timeZone, live: true };
}

/** A past day read at a local time. */
function pastMoment(timeZone: string, date: string, time: string): RuleMoment {
  const { start, end } = localDayBounds(date, timeZone);
  return { asOf: zonedToUtc(date, time, timeZone), date, dayStart: start, dayEnd: end, today: date, timeZone, live: false };
}
