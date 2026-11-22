import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { PaymentService } from "@healthcare/billing";
import { ClinicDashboardService } from "@healthcare/clinic";
import {
  type Actor,
  addDays,
  ASK_NOTE_TEXT,
  type AskNote,
  BusinessRuleError,
  type CompareMode,
  compareLabel,
  comparisonRange,
  DATABASE,
  type Database,
  DomainError,
  ForbiddenError,
  formatRange,
  interpretQuestion,
  isDayKey,
  localDate,
  NotFoundError,
  periodLabel,
  requireFacilityId,
  resolvePeriod,
  upToToday,
} from "@healthcare/core";
import { InventoryStockService, PurchaseOrderService } from "@healthcare/inventory";
import { LabWorklistService } from "@healthcare/laboratory";
import { facility } from "@healthcare/organization";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { METRIC_DEFINITIONS } from "../../management-dashboard/management-dashboard.definitions";
import { compareFigure, KEY_FIGURE_DIRECTIONS, type KeyFigures } from "../../management-dashboard/management-dashboard.rules";
import { ManagementDashboardService } from "../../management-dashboard/management-dashboard.service";
import { type AskAnswer, type AskRow, type AskStatus, changeText, count, formatFigure, minutes, peso } from "./ask-answer";
import { ASK_QUESTIONS, type AskQuestionDefinition, askQuestion } from "./ask-catalogue";
import { assistantAskedQuestion, type AskScope } from "./ask.schema";

/** Recent questions kept per person (saved ones are kept apart). */
export const RECENT_QUESTIONS = 50;
/** Saved questions per person. */
export const SAVED_QUESTIONS = 20;
/** Items listed in an answer about stock; the rest are counted. */
const LISTED = 10;

interface AskContext {
  actor: Actor;
  question: AskQuestionDefinition;
  facilityName: string;
  today: string;
  /** The dates read (null for a question about the present). */
  period: { key: string; from: string; to: string } | null;
  comparison: { mode: CompareMode; from: string; to: string } | null;
  scope: AskScope;
}

type Built = { status: AskStatus; sentence: string; rows?: AskRow[]; notes?: string[]; definition?: string | null; scopeName?: string };

export interface AskInput {
  questionId: string;
  period?: string;
  compare?: CompareMode;
  scope?: AskScope;
  notes?: AskNote[];
}

/**
 * The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): typed questions read against a closed catalogue,
 * answered by the public method of the route that already shows each figure (so its facility scope, withheld sections,
 * masking and audit apply as they do there), plus an `assistant.ask` audit row without the words typed. A person's
 * recent and saved questions keep the question, period and scope only.
 */
@Injectable()
export class AskService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly dashboards: ManagementDashboardService,
    private readonly clinic: ClinicDashboardService,
    private readonly payments: PaymentService,
    private readonly stock: InventoryStockService,
    private readonly orders: PurchaseOrderService,
    private readonly laboratory: LabWorklistService,
  ) {}

  /**
   * The catalogue as the caller sees it: whether each question's figures are theirs to see, and each example as it
   * reads (its period and comparison), so a screen can open an example's answer without sending its words.
   */
  async questions(actor: Actor) {
    const today = localDate(new Date(), (await this.facilityOf(actor)).timezone);
    const catalogue = ASK_QUESTIONS.map((q) => ({ ...q, allowed: this.allowed(actor, q) }));
    return ASK_QUESTIONS.map((q) => ({
      id: q.id,
      title: q.title,
      examples: q.examples.map((text) => {
        // Every example reads as its own question (a unit test holds the catalogue to it).
        const read = interpretQuestion(text, catalogue, today);
        const own = read.kind === "question" && read.questionId === q.id ? read : null;
        return { text, ...(own?.period ? { period: own.period } : {}), ...(own?.compare ? { compare: own.compare } : {}) };
      }),
      period: q.period,
      comparable: q.comparable,
      organization: q.organization,
      allowed: this.allowed(actor, q),
      link: q.link,
    }));
  }

  /**
   * Which question a text asks. Reads no figures and writes nothing: the text is matched and dropped, never stored,
   * logged or audited.
   */
  async interpret(actor: Actor, text: string, allFacilities = false) {
    const today = localDate(new Date(), (await this.facilityOf(actor)).timezone);
    const read = interpretQuestion(
      text,
      ASK_QUESTIONS.map((q) => ({ ...q, allowed: this.allowed(actor, q) })),
      today,
    );
    if (read.kind === "unrecognised") return read;
    if (read.kind === "ambiguous") {
      // The period, comparison and scope read go with the choice; the answer leaves out what does not apply to it.
      return {
        kind: read.kind,
        candidates: read.questionIds.map((id) => ({ id, title: askQuestion(id)!.title })),
        period: read.period,
        compare: read.compare,
        scope: (allFacilities || read.allFacilities ? "organization" : "facility") as AskScope,
      };
    }
    const question = askQuestion(read.questionId)!;
    const scope: AskScope = (allFacilities || read.allFacilities) && question.organization ? "organization" : "facility";
    return { kind: read.kind, questionId: read.questionId, title: question.title, period: read.period, compare: read.compare, scope, notes: read.notes };
  }

  /** The answer to one catalogue question, audited (question, period and scope only) and added to the person's questions. */
  async answer(actor: Actor, input: AskInput): Promise<AskAnswer> {
    const question = askQuestion(input.questionId);
    if (!question) throw new NotFoundError("Question");
    const place = await this.facilityOf(actor);
    const today = localDate(new Date(), place.timezone);
    const notes = (input.notes ?? []).map((n) => ASK_NOTE_TEXT[n]);

    let period: AskContext["period"] = null;
    let unavailable: string | null = null;
    if (question.period === "day" || question.period === "range") {
      let key = input.period ?? question.defaultPeriod!;
      if (question.period === "day" && !isDayKey(key)) {
        notes.push(ASK_NOTE_TEXT["day-only"]);
        key = question.defaultPeriod!;
      }
      const resolved = resolvePeriod(key, today);
      if (!resolved) throw new BusinessRuleError("That period cannot be read: choose at most 366 days that do not end before they start.", "invalid_period");
      const range = question.period === "range" ? upToToday(resolved, today) : resolved;
      if (!range) unavailable = "That period has not started yet.";
      else {
        if (range.to !== resolved.to) notes.push("Figures run up to today.");
        period = { key, ...range };
      }
    } else if (input.period) notes.push(ASK_NOTE_TEXT["period-not-applicable"]);

    let comparison: AskContext["comparison"] = null;
    if (input.compare && period) {
      if (question.comparable) comparison = { mode: input.compare, ...comparisonRange(period.key, period, input.compare) };
      else notes.push(ASK_NOTE_TEXT["not-comparable"]);
    }
    let scope: AskScope = input.scope ?? "facility";
    if (scope === "organization" && !question.organization) {
      notes.push("This question is answered for the selected facility.");
      scope = "facility";
    }
    const ctx: AskContext = { actor, question, facilityName: place.name, today, period, comparison, scope };

    let built: Built;
    if (unavailable) built = { status: "unavailable", sentence: unavailable };
    else if (!this.allowed(actor, question)) built = this.withheld(question);
    else {
      try {
        built = await this.build(ctx);
      } catch (error) {
        // The source refused (a facility outside the person's dashboard scope): withheld, as on its own screen.
        if (error instanceof ForbiddenError) built = this.withheld(question);
        else if (error instanceof DomainError && !(error instanceof NotFoundError)) built = { status: "unavailable", sentence: error.message };
        else throw error;
      }
    }

    // What was asked, never the words typed: question, version, dates, comparison, scope and the outcome.
    await this.audit.recordStandalone(actor, {
      action: "assistant.ask",
      resourceType: "assistant_question",
      metadata: {
        questionId: question.id,
        version: question.version,
        period: period?.key ?? null,
        from: period?.from ?? null,
        to: period?.to ?? null,
        compare: comparison?.mode ?? null,
        scope,
        result: built.status,
      },
    });
    // The period as asked ('' for the question's default), so a saved "last week" reads its own last week next time.
    const asked = input.period && period?.key === input.period ? input.period : "";
    const entry = built.status === "answered" ? await this.remember(actor, question.id, asked, comparison?.mode ?? "", scope) : null;

    return {
      question: { id: question.id, version: question.version, title: question.title },
      status: built.status,
      sentence: built.sentence,
      period: period ? { key: period.key, label: periodLabel(period.key), from: period.from, to: period.to, text: formatRange(period.from, period.to) } : null,
      comparison: comparison
        ? {
            mode: comparison.mode,
            label: compareLabel(comparison.mode),
            from: comparison.from,
            to: comparison.to,
            text: formatRange(comparison.from, comparison.to),
          }
        : null,
      scope: { kind: scope, name: built.scopeName ?? place.name },
      rows: built.rows ?? [],
      notes: [...notes, ...(built.notes ?? [])],
      definition: built.definition ?? null,
      link: built.status === "answered" ? question.link : null,
      entry,
    };
  }

  // ---- the person's questions -------------------------------------------------------------------------------------

  async history(actor: Actor) {
    const rows = await this.db
      .select()
      .from(assistantAskedQuestion)
      .where(and(eq(assistantAskedQuestion.organizationId, actor.organizationId), eq(assistantAskedQuestion.userId, actor.userId)))
      .orderBy(desc(assistantAskedQuestion.lastAskedAt))
      .limit(RECENT_QUESTIONS + SAVED_QUESTIONS);
    const view = (r: typeof assistantAskedQuestion.$inferSelect) => {
      const question = askQuestion(r.questionId);
      if (!question) return null;
      const parts = [question.title, r.periodKey ? periodLabel(r.periodKey) : null, r.compareKey ? `vs ${compareLabel(r.compareKey as CompareMode)}` : null];
      if (r.scope === "organization") parts.push("all facilities");
      return {
        id: r.id,
        questionId: r.questionId,
        label: parts.filter(Boolean).join(", "),
        period: r.periodKey || null,
        compare: (r.compareKey || null) as CompareMode | null,
        scope: r.scope,
        timesAsked: r.timesAsked,
        lastAskedAt: r.lastAskedAt.toISOString(),
        savedAt: r.savedAt?.toISOString() ?? null,
      };
    };
    const all = rows.map(view).filter((r): r is NonNullable<typeof r> => r !== null);
    return { saved: all.filter((r) => r.savedAt), recent: all.filter((r) => !r.savedAt).slice(0, RECENT_QUESTIONS) };
  }

  async save(actor: Actor, id: string): Promise<{ id: string }> {
    await this.own(actor, id);
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(assistantAskedQuestion)
      .where(and(this.mine(actor), isNotNull(assistantAskedQuestion.savedAt)));
    if (n >= SAVED_QUESTIONS) throw new BusinessRuleError(`Keep at most ${SAVED_QUESTIONS} saved questions: remove one first.`, "saved_question_limit");
    await this.db
      .update(assistantAskedQuestion)
      .set({ savedAt: sql`coalesce(${assistantAskedQuestion.savedAt}, now())` })
      .where(and(this.mine(actor), eq(assistantAskedQuestion.id, id)));
    return { id };
  }

  async unsave(actor: Actor, id: string): Promise<{ id: string }> {
    await this.own(actor, id);
    await this.db
      .update(assistantAskedQuestion)
      .set({ savedAt: null })
      .where(and(this.mine(actor), eq(assistantAskedQuestion.id, id)));
    return { id };
  }

  async remove(actor: Actor, id: string): Promise<{ id: string }> {
    await this.own(actor, id);
    await this.db.delete(assistantAskedQuestion).where(and(this.mine(actor), eq(assistantAskedQuestion.id, id)));
    return { id };
  }

  /** Forgets the person's recent questions; saved ones stay. */
  async clear(actor: Actor): Promise<{ removed: number }> {
    const removed = await this.db
      .delete(assistantAskedQuestion)
      .where(and(this.mine(actor), isNull(assistantAskedQuestion.savedAt)))
      .returning({ id: assistantAskedQuestion.id });
    return { removed: removed.length };
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private allowed(actor: Actor, question: AskQuestionDefinition): boolean {
    return question.requires.every((p) => actor.permissions.has(p));
  }

  private withheld(question: AskQuestionDefinition): Built {
    return {
      status: "withheld",
      sentence: `This answer comes from figures your role cannot open (${question.link.label.replace(/^Open /, "")}), so it is not shown.`,
    };
  }

  private mine(actor: Actor) {
    return and(eq(assistantAskedQuestion.organizationId, actor.organizationId), eq(assistantAskedQuestion.userId, actor.userId));
  }

  private async own(actor: Actor, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: assistantAskedQuestion.id })
      .from(assistantAskedQuestion)
      .where(and(this.mine(actor), eq(assistantAskedQuestion.id, id)));
    if (!row) throw new NotFoundError("Question");
  }

  /** Adds the question to the person's recent ones (or counts it again), keeping the latest `RECENT_QUESTIONS` unsaved. */
  private async remember(actor: Actor, questionId: string, periodKey: string, compareKey: string, scope: AskScope): Promise<{ id: string }> {
    const t = assistantAskedQuestion;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t)
        .values({ organizationId: actor.organizationId, userId: actor.userId, questionId, periodKey, compareKey, scope })
        .onConflictDoUpdate({
          target: [t.organizationId, t.userId, t.questionId, t.periodKey, t.compareKey, t.scope],
          set: { timesAsked: sql`${t.timesAsked} + 1`, lastAskedAt: sql`now()` },
        })
        .returning({ id: t.id });
      // The row just asked is the newest, so it is never the one dropped.
      await tx.execute(sql`
        DELETE FROM assistant_asked_question
        WHERE id IN (
          SELECT id FROM assistant_asked_question
          WHERE organization_id = ${actor.organizationId}::uuid AND user_id = ${actor.userId}::uuid AND saved_at IS NULL
          ORDER BY last_asked_at DESC
          OFFSET ${RECENT_QUESTIONS}
        )`);
      return { id: row!.id };
    });
  }

  private async facilityOf(actor: Actor): Promise<{ name: string; timezone: string }> {
    const facilityId = requireFacilityId(actor);
    const [row] = await this.db
      .select({ name: facility.name, timezone: facility.timezone })
      .from(facility)
      .where(and(eq(facility.organizationId, actor.organizationId), eq(facility.id, facilityId)));
    if (!row) throw new NotFoundError("Facility");
    return row;
  }

  private async build(ctx: AskContext): Promise<Built> {
    switch (ctx.question.id) {
      case "clinic.no-shows":
      case "clinic.patients-seen":
      case "clinic.wait-time":
      case "laboratory.turnaround":
      case "billing.revenue":
      case "inventory.stock-used":
      case "pharmacy.dispensed":
        return this.fromDashboard(ctx);
      case "clinic.appointments":
        return this.appointments(ctx);
      case "clinic.waiting-now":
        return this.waitingNow(ctx);
      case "billing.collections":
        return this.collections(ctx);
      case "billing.owed":
        return this.owed(ctx);
      case "inventory.low":
        return this.lowStock(ctx);
      case "inventory.expiring":
        return this.expiring(ctx);
      case "inventory.reorder":
        return this.reorder(ctx);
      case "laboratory.today":
        return this.laboratoryToday(ctx);
      default:
        throw new NotFoundError("Question");
    }
  }

  // ---- questions read from the management dashboard ---------------------------------------------------------------

  private async fromDashboard(ctx: AskContext): Promise<Built> {
    const read = (range: { from: string; to: string }) =>
      this.dashboards.dashboard(ctx.actor, { from: range.from, to: range.to, facilityId: ctx.scope === "facility" ? ctx.actor.facilityId : undefined });
    const current = await read(ctx.period!);
    const previous = ctx.comparison ? await read(ctx.comparison) : null;
    const scopeName =
      ctx.scope === "facility" ? ctx.facilityName : current.facilityIds === null ? "the whole organization" : `${current.facilityIds.length} facilities`;
    const where = `at ${scopeName}, ${formatRange(ctx.period!.from, ctx.period!.to)}`;
    const row = (label: string, key: keyof KeyFigures): AskRow => {
      const { unit, better } = KEY_FIGURE_DIRECTIONS[key];
      const value = current.keyFigures[key];
      const before = previous?.keyFigures[key];
      return {
        label,
        value: formatFigure(unit, value),
        ...(previous ? { previous: formatFigure(unit, before ?? null), change: changeText(compareFigure(unit, better, value, before ?? null)) } : {}),
      };
    };
    const section = (name: "billing" | "inventory" | "dispensing") => current.withheld.includes(name) || (previous?.withheld.includes(name) ?? false);
    const k = current.keyFigures;

    switch (ctx.question.id) {
      case "clinic.no-shows": {
        const a = current.clinic.appointments;
        return {
          status: "answered",
          scopeName,
          sentence:
            k.noShowRate === null
              ? `No appointments were booked ${where}.`
              : `${formatFigure("rate", k.noShowRate)} of appointments were no-shows ${where}: ${count(a.noShow)} of ${count(a.booked)}.`,
          rows: [row("No-show rate", "noShowRate"), { label: "No-shows", value: count(a.noShow) }, { label: "Appointments booked", value: count(a.booked) }],
          definition: METRIC_DEFINITIONS.noShowRate,
        };
      }
      case "clinic.patients-seen":
        return {
          status: "answered",
          scopeName,
          sentence: `${capitalize(formatFigure("patients", k.patientsSeen))} ${k.patientsSeen === 1 ? "patient was" : "patients were"} seen ${where}.`,
          rows: [row("Patients seen", "patientsSeen"), row("New patients registered", "newPatients"), row("Consultations completed", "consultations")],
          definition: METRIC_DEFINITIONS.patientsSeen,
        };
      case "clinic.wait-time":
        return {
          status: "answered",
          scopeName,
          sentence:
            k.averageWaitMinutes === null
              ? `No waits were recorded ${where}.`
              : `Patients waited ${minutes(k.averageWaitMinutes)} on average${k.medianWaitMinutes === null ? "" : ` (half of them ${minutes(k.medianWaitMinutes)} or less)`} ${where}.`,
          rows: [row("Average wait", "averageWaitMinutes"), row("Median wait", "medianWaitMinutes")],
          definition: METRIC_DEFINITIONS.averageWait,
        };
      case "laboratory.turnaround":
        return {
          status: "answered",
          scopeName,
          sentence:
            k.labTurnaroundMinutes === null
              ? `No laboratory results were released ${where}.`
              : `Laboratory results took ${minutes(k.labTurnaroundMinutes)} on average${k.medianLabTurnaroundMinutes === null ? "" : ` (median ${minutes(k.medianLabTurnaroundMinutes)})`}; ${count(k.labTestsReleased)} tests were released ${where}.`,
          rows: [
            row("Average turnaround", "labTurnaroundMinutes"),
            row("Median turnaround", "medianLabTurnaroundMinutes"),
            row("Tests released", "labTestsReleased"),
            row("Specimens rejected", "specimenRejectionRate"),
          ],
          definition: METRIC_DEFINITIONS.labTurnaround,
        };
      case "billing.revenue":
        if (section("billing")) return this.withheld(ctx.question);
        return {
          status: "answered",
          scopeName,
          sentence: `${peso(k.netInvoiced ?? 0)} was invoiced and ${peso(k.netCollected ?? 0)} collected (net) ${where}.`,
          rows: [row("Invoiced (net)", "netInvoiced"), row("Collected (net)", "netCollected")],
          definition: `${METRIC_DEFINITIONS.invoicedNet} ${METRIC_DEFINITIONS.collected}`,
        };
      case "inventory.stock-used":
        if (section("inventory")) return this.withheld(ctx.question);
        return {
          status: "answered",
          scopeName,
          sentence: `Stock worth ${peso(k.stockUsed ?? 0)} was used ${where}.`,
          rows: [
            row("Stock used", "stockUsed"),
            { label: "Stock received", value: peso(current.inventory?.received.value ?? 0) },
            { label: "Written off", value: peso(current.inventory?.writtenOff.value ?? 0) },
          ],
          definition: METRIC_DEFINITIONS.stock,
        };
      default: {
        if (section("dispensing")) return this.withheld(ctx.question);
        const rx = current.dispensing;
        return {
          status: "answered",
          scopeName,
          sentence: `${count(k.dispenses ?? 0)} dispense lines were recorded for ${count(rx?.prescriptionsDispensed ?? 0)} prescriptions ${where}.`,
          rows: [
            row("Dispense lines", "dispenses"),
            { label: "Prescriptions dispensed", value: count(rx?.prescriptionsDispensed ?? 0) },
            { label: "Prescriptions issued", value: count(rx?.prescriptionsIssued ?? 0) },
          ],
          definition: METRIC_DEFINITIONS.dispensing,
        };
      }
    }
  }

  // ---- questions read from the screens' own routes ----------------------------------------------------------------

  private async appointments(ctx: AskContext): Promise<Built> {
    const day = ctx.period!.from;
    const data = await this.clinic.forFacility(ctx.actor, day);
    const when = day === ctx.today ? "today" : day === addDays(ctx.today, 1) ? "tomorrow" : `on ${formatRange(day, day)}`;
    const byStatus = data.appointments.byStatus as Record<string, number>;
    const rows = APPOINTMENT_STATUSES.filter(([status]) => (byStatus[status] ?? 0) > 0).map(([status, label]) => ({
      label,
      value: count(byStatus[status] ?? 0),
    }));
    return {
      status: "answered",
      sentence:
        data.appointments.total === 0
          ? `No appointments ${when} at ${ctx.facilityName}.`
          : `${count(data.appointments.total)} ${data.appointments.total === 1 ? "appointment" : "appointments"} ${when} at ${ctx.facilityName}.`,
      rows: [{ label: "Appointments", value: count(data.appointments.total) }, ...rows],
      definition: "Appointments starting that day at the selected facility, cancelled ones left out of the total.",
    };
  }

  private async waitingNow(ctx: AskContext): Promise<Built> {
    const data = await this.clinic.forFacility(ctx.actor);
    const q = data.queue;
    return {
      status: "answered",
      sentence:
        q.waiting === 0
          ? `Nobody is waiting at ${ctx.facilityName} now.`
          : `${count(q.waiting)} ${q.waiting === 1 ? "patient is" : "patients are"} waiting at ${ctx.facilityName} now${q.longestCurrentWaitMinutes === null ? "" : `; the longest has waited ${minutes(q.longestCurrentWaitMinutes)}`}.`,
      rows: [
        { label: "Waiting (to be seen, in triage or for the doctor)", value: count(q.waiting) },
        { label: "In consultation", value: count(q.inConsultation) },
        ...(q.longestCurrentWaitMinutes === null ? [] : [{ label: "Longest wait now", value: minutes(q.longestCurrentWaitMinutes) }]),
        ...(q.averageWaitMinutes === null ? [] : [{ label: "Average wait today", value: minutes(q.averageWaitMinutes) }]),
      ],
      definition: "Today's queue at the selected facility: waits run from check-in to being called.",
    };
  }

  private async collections(ctx: AskContext): Promise<Built> {
    const day = ctx.period!.from;
    const r = await this.payments.dailyReport(ctx.actor, day);
    const when = day === ctx.today ? "today" : `on ${formatRange(day, day)}`;
    return {
      status: "answered",
      sentence: `${peso(r.collectedTotal)} was collected ${when} at ${ctx.facilityName}${r.refundedTotal > 0 ? `, and ${peso(r.refundedTotal)} refunded` : ""}.`,
      rows: [
        { label: "Collected", value: peso(r.collectedTotal) },
        ...r.collections.map((c) => ({ label: `By ${METHOD_LABEL[c.method] ?? c.method}`, value: peso(c.amount) })),
        { label: "Refunded", value: peso(r.refundedTotal) },
        { label: "Deposits received", value: peso(r.deposits.receivedTotal) },
      ],
      definition: "Payments recorded that day at the selected facility, by method; refunds and deposits apart.",
    };
  }

  private async owed(ctx: AskContext): Promise<Built> {
    const r = await this.payments.dailyReport(ctx.actor, ctx.today);
    const owed = r.receivables;
    return {
      status: "answered",
      sentence: `Patients owe ${peso(owed.patientBalance)} on ${count(owed.invoices)} issued ${owed.invoices === 1 ? "invoice" : "invoices"} at ${ctx.facilityName}, and ${peso(owed.payerPending)} of HMO and PhilHealth coverage is still pending.`,
      rows: [
        { label: "Owed by patients", value: peso(owed.patientBalance) },
        { label: "Invoices with a balance", value: count(owed.invoices) },
        { label: "Payer coverage pending", value: peso(owed.payerPending) },
      ],
      notes: ["Totals only: who owes what is on the invoices list."],
      definition: "Balances of issued invoices at the selected facility, all dates; payer coverage not yet settled or denied.",
    };
  }

  private async lowStock(ctx: AskContext): Promise<Built> {
    const { rows } = await this.stock.stock(ctx.actor, { show: "low", withinDays: 60 });
    return {
      status: "answered",
      sentence:
        rows.length === 0
          ? `Nothing is at or below its reorder level at ${ctx.facilityName}.`
          : `${count(rows.length)} ${rows.length === 1 ? "item is" : "items are"} low or out at ${ctx.facilityName}.`,
      rows: rows.slice(0, LISTED).map((r) => ({
        label: `${r.item.name} (${r.location.name})`,
        value: `${r.status === "out" ? "Out" : `${count(r.usable)} ${r.item.stockUnit} usable`}${r.reorderLevel === null ? "" : `, reorder level ${count(r.reorderLevel)}`}`,
      })),
      notes: rows.length > LISTED ? [`${count(rows.length - LISTED)} more on the inventory screen.`] : [],
      definition: "Items at the selected facility whose usable stock is at or below the reorder level set for them, or none left.",
    };
  }

  private async expiring(ctx: AskContext): Promise<Built> {
    const { rows } = await this.stock.stock(ctx.actor, { show: "expiring", withinDays: 60 });
    const lots = rows.flatMap((r) =>
      r.lots.filter((l) => l.expiry === "expired" || l.expiry === "expiring").map((l) => ({ ...l, item: r.item, location: r.location })),
    );
    lots.sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""));
    return {
      status: "answered",
      sentence:
        lots.length === 0
          ? `No stock at ${ctx.facilityName} expires within 60 days.`
          : `${count(lots.length)} ${lots.length === 1 ? "lot has" : "lots have"} expired or expire within 60 days at ${ctx.facilityName}.`,
      rows: lots.slice(0, LISTED).map((l) => ({
        label: `${l.item.name}${l.lotNumber ? `, lot ${l.lotNumber}` : ""} (${l.location.name})`,
        value:
          `${count(l.quantity)} ${l.item.stockUnit}, ${l.expiry === "expired" ? "expired" : "expires"} ${l.expiryDate ? formatRange(l.expiryDate, l.expiryDate) : ""}`.trim(),
      })),
      notes: lots.length > LISTED ? [`${count(lots.length - LISTED)} more on the inventory screen.`] : [],
      definition: "Lots with stock at the selected facility that have expired or expire within 60 days.",
    };
  }

  private async reorder(ctx: AskContext): Promise<Built> {
    const items = await this.orders.suggestions(ctx.actor);
    return {
      status: "answered",
      sentence:
        items.length === 0
          ? `No item is at or below its reorder level at ${ctx.facilityName}, counting what is already on order.`
          : `${count(items.length)} ${items.length === 1 ? "item is" : "items are"} at or below the reorder level at ${ctx.facilityName}, counting what is already on order.`,
      rows: items.slice(0, LISTED).map((s) => ({
        label: `${s.item.name} (${s.location.name})`,
        value:
          s.suggestedQuantity === null
            ? `${count(s.usable)} ${s.item.stockUnit} usable, ${count(s.onOrder)} on order`
            : `Order ${count(s.suggestedQuantity)} ${s.item.stockUnit} (${count(s.usable)} usable, ${count(s.onOrder)} on order)`,
      })),
      notes: [
        ...(items.length > LISTED ? [`${count(items.length - LISTED)} more on the purchase orders screen.`] : []),
        "Only items with a reorder level are listed; the quantity is the one set for each item.",
      ],
      definition: "Items whose usable stock plus open purchase orders is at or below their reorder level at the selected facility.",
    };
  }

  private async laboratoryToday(ctx: AskContext): Promise<Built> {
    const d = await this.laboratory.dashboard(ctx.actor);
    const waiting = d.pendingCollection + d.awaitingReceipt + d.awaitingEntry + d.awaitingVerification + d.awaitingApproval + d.awaitingRelease;
    return {
      status: "answered",
      sentence: `${count(waiting)} ${waiting === 1 ? "test is" : "tests are"} in progress at ${ctx.facilityName}'s laboratory${d.overdue > 0 ? `, ${count(d.overdue)} overdue` : ""}${d.criticalUnacknowledged > 0 ? `; ${count(d.criticalUnacknowledged)} critical ${d.criticalUnacknowledged === 1 ? "result awaits" : "results await"} acknowledgement` : ""}.`,
      rows: [
        { label: "To collect", value: count(d.pendingCollection) },
        { label: "To receive", value: count(d.awaitingReceipt) },
        { label: "Result to enter", value: count(d.awaitingEntry) },
        { label: "To verify", value: count(d.awaitingVerification) },
        { label: "To approve", value: count(d.awaitingApproval) },
        { label: "To release", value: count(d.awaitingRelease) },
        { label: "Overdue", value: count(d.overdue) },
        { label: "Critical results not acknowledged", value: count(d.criticalUnacknowledged) },
        { label: "Released today", value: count(d.releasedToday) },
      ],
      definition: "Today's laboratory workbench at the selected facility, by stage.",
    };
  }
}

const APPOINTMENT_STATUSES: Array<[string, string]> = [
  ["booked", "Booked"],
  ["confirmed", "Confirmed"],
  ["checked_in", "Checked in"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["no_show", "No-show"],
  ["cancelled", "Cancelled"],
];

const METHOD_LABEL: Record<string, string> = {
  cash: "cash",
  card: "card",
  e_wallet: "e-wallet",
  bank_transfer: "bank transfer",
  check: "check",
  online: "online payment",
  other: "other",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
