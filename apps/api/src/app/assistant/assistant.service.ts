import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { UsersService } from "@healthcare/auth";
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
  PH_TIMEZONE,
  requireFacilityId,
  type RuleParameterLabel,
  type Suggestion,
  type SuggestionSurface,
  VersionConflictError,
  zonedToUtc,
} from "@healthcare/core";
import { facility } from "@healthcare/organization";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { AssistantRules, type PrescriptionDraft, type RuleBinding, type RuleMoment } from "./assistant-rules";
import {
  assistantFeedback,
  assistantRuleReview,
  assistantRuleSetting,
  assistantRuleShown,
  type AssistantOutcome,
  type RuleReviewOutcome,
} from "./assistant.schema";

/** A dismissed suggestion stays hidden from the person who dismissed it for this long; the same finding may then return. */
export const DISMISSAL_DAYS = 14;

/** The most suggestions one request returns. */
const MAX_SUGGESTIONS = 20;

/** The most past days one replay reads. */
export const MAX_REPLAY_DAYS = 31;

/** A rule turned on is due for review when its last review is older than this (the quarterly review, with some slack). */
export const REVIEW_DUE_DAYS = 92;

/** The most recent reasons staff gave, per rule, on the insights page. */
const REASONS_PER_RULE = 5;

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
    private readonly users: UsersService,
  ) {}

  // ---- suggestions -------------------------------------------------------------------------------------------------

  /**
   * `date` (YYYY-MM-DD): the day a screen shows (the appointments board); `encounterId`: the consultation a consultation
   * screen shows; `patientId`: the patient a patient screen shows (the dental record); `prescriptionId`: the prescription
   * the dispense screen shows; `prescriptionDraft`: a prescription being written, checked before it is issued (surface
   * `prescribing`).
   */
  async suggestions(
    actor: Actor,
    surface: SuggestionSurface,
    context: { date?: string; encounterId?: string; patientId?: string; prescriptionId?: string; prescriptionDraft?: PrescriptionDraft } = {},
  ): Promise<SuggestionsAnswer> {
    const facilityId = requireFacilityId(actor);
    const timeZone = await this.facilityTimeZone(actor, facilityId);
    const moment = {
      ...liveMoment(timeZone, context.date),
      encounterId: context.encounterId,
      patientId: context.patientId,
      prescriptionId: context.prescriptionId,
      prescriptionDraft: context.prescriptionDraft,
    };
    const encounterId = context.encounterId ?? context.prescriptionDraft?.encounterId;
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
    await this.countShown(actor.organizationId, facilityId, moment.today, shown);
    await this.audit.recordStandalone(actor, {
      action: "assistant.view",
      resourceType: "assistant_surface",
      metadata: {
        surface,
        rules: ran,
        shown: shown.length,
        ...(encounterId ? { encounterId } : {}),
        ...(context.patientId ? { patientId: context.patientId } : {}),
        ...(context.prescriptionId ? { prescriptionId: context.prescriptionId } : {}),
        ...(context.prescriptionDraft ? { medicines: context.prescriptionDraft.medicines.length } : {}),
      },
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
    const reviews = await this.latestReviews(actor.organizationId);
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
      lastReview: reviews.get(definition.id) ?? null,
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

  /**
   * How each rule did over the last `days` days in the organization, for its periodic review (docs/runbooks/
   * assistant-rule-review.md): times shown, followed (`accepted`), dismissed and marked not useful, the latest reasons
   * staff gave, where it is on, and its last review. Counts and the reasons' words only — never a finding or a person.
   */
  async insights(actor: Actor, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const org = actor.organizationId;
    const rows = await this.db
      .select({
        ruleId: assistantFeedback.ruleId,
        outcome: assistantFeedback.outcome,
        count: sql<number>`count(*)::int`,
      })
      .from(assistantFeedback)
      .where(and(eq(assistantFeedback.organizationId, org), gte(assistantFeedback.createdAt, since)))
      .groupBy(assistantFeedback.ruleId, assistantFeedback.outcome);
    const shown = await this.db
      .select({ ruleId: assistantRuleShown.ruleId, shown: sql<number>`sum(${assistantRuleShown.shown})::int` })
      .from(assistantRuleShown)
      .where(and(eq(assistantRuleShown.organizationId, org), gte(assistantRuleShown.day, localDate(since, PH_TIMEZONE))))
      .groupBy(assistantRuleShown.ruleId);
    const reasons = await this.db
      .select({ ruleId: assistantFeedback.ruleId, outcome: assistantFeedback.outcome, reason: assistantFeedback.reason, at: assistantFeedback.createdAt })
      .from(assistantFeedback)
      .where(
        and(
          eq(assistantFeedback.organizationId, org),
          gte(assistantFeedback.createdAt, since),
          sql`${assistantFeedback.reason} IS NOT NULL`,
          or(eq(assistantFeedback.outcome, "dismissed"), eq(assistantFeedback.outcome, "not_useful")),
        ),
      )
      .orderBy(desc(assistantFeedback.createdAt))
      .limit(500);
    const enabled = await this.enabledScopes(org);
    const reviews = await this.latestReviews(org);
    const today = localDate(new Date(), PH_TIMEZONE);
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
        const on = enabled.get(definition.id) ?? { organization: false, facilities: 0 };
        const lastReview = reviews.get(definition.id) ?? null;
        const isOn = on.organization || on.facilities > 0;
        return {
          ruleId: definition.id,
          ruleVersion: definition.version,
          title: definition.title,
          description: definition.description,
          domain: definition.domain,
          enabled: on,
          shown: shown.find((r) => r.ruleId === definition.id)?.shown ?? 0,
          accepted,
          dismissed,
          notUseful,
          answered,
          // Flagged for the administrator to look at, never changed on its own (the sample must be meaningful).
          reviewSuggested: answered >= 20 && (dismissed + notUseful) / answered >= 0.7,
          // On somewhere and never reviewed, reviewed too long ago, or reviewed on an earlier version of its logic.
          reviewDue: isOn && (!lastReview || lastReview.ruleVersion < definition.version || daysBetween(lastReview.reviewedOn, today) > REVIEW_DUE_DAYS),
          reasons: reasons
            .filter((r) => r.ruleId === definition.id)
            .slice(0, REASONS_PER_RULE)
            .map((r) => ({ outcome: r.outcome, reason: r.reason!, at: r.at.toISOString() })),
          lastReview,
        };
      }),
    };
  }

  /** A rule's reviews, newest first, with who recorded each. */
  async reviews(actor: Actor, ruleId: string) {
    if (!this.rules.find(ruleId)) throw new NotFoundError("Assistant rule");
    const rows = await this.db
      .select()
      .from(assistantRuleReview)
      .where(and(eq(assistantRuleReview.organizationId, actor.organizationId), eq(assistantRuleReview.ruleId, ruleId)))
      .orderBy(desc(assistantRuleReview.recordedAt))
      .limit(100);
    const names = await this.users.displayNames(actor.organizationId, [...new Set(rows.map((r) => r.recordedBy))]);
    return rows.map((r) => ({ ...reviewView(r), recordedBy: names.get(r.recordedBy) ?? "A staff account", recordedAt: r.recordedAt.toISOString() }));
  }

  /**
   * Records the organization's review of a rule: keep it, adjust it (its thresholds are changed on the settings screen),
   * or retire it — then it is turned off, in the same transaction, wherever it is on in the organization (a new setting
   * version for each such scope, parameters kept). Append-only; audited with the outcome, never the note.
   */
  async recordReview(
    actor: Actor,
    ruleId: string,
    input: { outcome: RuleReviewOutcome; note: string; falsePositives?: string; reviewedOn: string },
  ): Promise<{ id: string; outcome: RuleReviewOutcome; turnedOff: number }> {
    const binding = this.rules.find(ruleId);
    if (!binding) throw new NotFoundError("Assistant rule");
    if (input.reviewedOn > localDate(new Date(), PH_TIMEZONE)) throw new BusinessRuleError("A review cannot be dated in the future", "review_date_in_future");
    try {
      return await this.db.transaction(async (tx) => {
        const [review] = await tx
          .insert(assistantRuleReview)
          .values({
            organizationId: actor.organizationId,
            ruleId,
            ruleVersion: binding.definition.version,
            outcome: input.outcome,
            note: input.note,
            falsePositives: input.falsePositives ?? null,
            reviewedOn: input.reviewedOn,
            recordedBy: actor.userId,
          })
          .returning({ id: assistantRuleReview.id });
        let turnedOff = 0;
        if (input.outcome === "retire") {
          const latest = await tx.execute<{ facility_id: string | null; version: number; parameters: Record<string, unknown>; enabled: boolean }>(sql`
            SELECT DISTINCT ON (facility_id) facility_id, version, parameters, enabled
            FROM assistant_rule_setting
            WHERE organization_id = ${actor.organizationId}::uuid AND rule_id = ${ruleId}
            ORDER BY facility_id, version DESC
          `);
          for (const row of latest.rows) {
            if (!row.enabled) continue;
            await tx.insert(assistantRuleSetting).values({
              organizationId: actor.organizationId,
              facilityId: row.facility_id,
              ruleId,
              version: row.version + 1,
              enabled: false,
              parameters: row.parameters,
              updatedBy: actor.userId,
            });
            turnedOff += 1;
          }
        }
        await this.audit.record(tx, actor, {
          action: "assistant.rule-review",
          resourceType: "assistant_rule",
          resourceId: review!.id,
          metadata: { ruleId, ruleVersion: binding.definition.version, outcome: input.outcome, turnedOff },
        });
        return { id: review!.id, outcome: input.outcome, turnedOff };
      });
    } catch (error) {
      // A setting saved for the same scope at the same moment: the unique version index lets one win.
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new VersionConflictError("Assistant rule setting", 0);
      throw error;
    }
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  /** Adds what a request showed to each rule's count for the facility's day (counts only; nothing of a suggestion). */
  private async countShown(organizationId: string, facilityId: string, day: string, shown: readonly Suggestion[]): Promise<void> {
    const byRule = new Map<string, number>();
    for (const suggestion of shown) byRule.set(suggestion.ruleId, (byRule.get(suggestion.ruleId) ?? 0) + 1);
    if (byRule.size === 0) return;
    await this.db
      .insert(assistantRuleShown)
      .values([...byRule].map(([ruleId, count]) => ({ organizationId, facilityId, ruleId, day, shown: count })))
      .onConflictDoUpdate({
        target: [assistantRuleShown.organizationId, assistantRuleShown.facilityId, assistantRuleShown.ruleId, assistantRuleShown.day],
        set: { shown: sql`${assistantRuleShown.shown} + excluded.shown` },
      });
  }

  /** Where each rule is on now: the organization's own setting, and how many facilities' settings. */
  private async enabledScopes(organizationId: string): Promise<Map<string, { organization: boolean; facilities: number }>> {
    const { rows } = await this.db.execute<{ facility_id: string | null; rule_id: string; enabled: boolean }>(sql`
      SELECT DISTINCT ON (facility_id, rule_id) facility_id, rule_id, enabled
      FROM assistant_rule_setting
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY facility_id, rule_id, version DESC
    `);
    const out = new Map<string, { organization: boolean; facilities: number }>();
    for (const row of rows) {
      const state = out.get(row.rule_id) ?? { organization: false, facilities: 0 };
      if (row.facility_id === null) state.organization = row.enabled;
      else if (row.enabled) state.facilities += 1;
      out.set(row.rule_id, state);
    }
    return out;
  }

  /** Each rule's latest review in the organization. */
  private async latestReviews(organizationId: string): Promise<Map<string, ReturnType<typeof reviewView>>> {
    const rows = await this.db
      .selectDistinctOn([assistantRuleReview.ruleId])
      .from(assistantRuleReview)
      .where(eq(assistantRuleReview.organizationId, organizationId))
      .orderBy(assistantRuleReview.ruleId, desc(assistantRuleReview.recordedAt));
    return new Map(rows.map((r) => [r.ruleId, reviewView(r)]));
  }

  /** The first wrong parameter, named in the settings screen's own words. */
  private invalidParameters(binding: RuleBinding, issues: ReadonlyArray<{ path: PropertyKey[]; code?: string; message?: string }>): BusinessRuleError {
    const labels = binding.definition.parameterLabels as Record<string, RuleParameterLabel>;
    const first = issues[0];
    const field = first ? labels[String(first.path[0])] : undefined;
    // A check across fields (e.g. hours that must end after they start) says what is wrong in its own words.
    const message =
      field && first?.code === "custom" && first.message
        ? `${field.label}: ${first.message}.`
        : field
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

function reviewView(row: typeof assistantRuleReview.$inferSelect) {
  return {
    id: row.id,
    ruleVersion: row.ruleVersion,
    outcome: row.outcome,
    note: row.note,
    falsePositives: row.falsePositives,
    reviewedOn: row.reviewedOn,
  };
}

/** Whole days from one local date (YYYY-MM-DD) to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
