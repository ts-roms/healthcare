import { Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { BillingRecordQueries, formatPeso } from "@healthcare/billing";
import { CarePlanService } from "@healthcare/care-plan";
import { ClinicQueries, doseText, ImmunizationService, occurrenceText } from "@healthcare/clinic";
import { type Actor, BadRequestError, localDayBounds, NotFoundError, PH_TIMEZONE, type TimelinePosition, type TimelineWindow } from "@healthcare/core";
import { DentalRecordQueries } from "@healthcare/dental";
import { DocumentRecordQueries } from "@healthcare/documents";
import { LabRecordQueries } from "@healthcare/laboratory";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";
import { PrescriptionService } from "@healthcare/prescription";
import {
  decodeCursor,
  encodeCursor,
  humanize,
  mergePage,
  summarizeNames,
  TIMELINE_PAGE_SIZE,
  type TimelineKind,
  type TimelineSource,
  visibleKinds,
} from "./timeline.rules";

/** The screen an entry opens (the staff app maps each to an existing route). */
export type TimelineLinkType =
  | "appointment"
  | "telemedicine"
  | "encounter"
  | "patient_laboratory"
  | "dental_record"
  | "care_plan"
  | "invoice"
  | "patient_external_history"
  | "patient_immunizations"
  | "patient_record";

/**
 * One row of the timeline, the same shape for every kind. Short display text only: no notes, narratives, reasons,
 * result values or message content — the linked record shows the rest (and audits that access).
 */
export interface TimelineEntry {
  /** `{source}:{uuid}`, unique across kinds. */
  id: string;
  kind: TimelineKind;
  /** ISO 8601 instant (UTC, microseconds). */
  occurredAt: string;
  facility: { id: string; name: string } | null;
  title: string;
  detail: string | null;
  /** The source record's status code as the domain stores it (e.g. `completed`, `entered_in_error`, `void`). */
  status: string | null;
  /** Set when the record is not valid care (entered in error, cancelled, voided): shown for history, marked. */
  marker: "entered_in_error" | "cancelled" | "void" | null;
  /** Laboratory releases only: whether any released result was flagged. */
  flag: "abnormal" | "critical" | null;
  link: { type: TimelineLinkType; id: string } | null;
  /** The patient number of a merged record the row is filed under (ADR-0009); null when filed under this patient. */
  filedUnder: string | null;
  sourceIds: Record<string, string>;
}

export interface TimelinePage {
  items: TimelineEntry[];
  nextCursor: string | null;
  /** Kinds the caller asked for (or all) but may not see; no counts are given for them. */
  withheld: TimelineKind[];
  /** The time zone `from`/`to` were read in. */
  timeZone: string;
}

export interface TimelineQuery {
  kinds?: TimelineKind[];
  from?: string;
  to?: string;
  facilityId?: string;
  cursor?: string;
  limit?: number;
}

type Draft = Omit<TimelineEntry, "id" | "kind" | "occurredAt" | "facility" | "marker" | "flag" | "filedUnder" | "sourceIds"> &
  Partial<Pick<TimelineEntry, "marker" | "flag">> & { sourceIds?: Record<string, string> };

interface Row extends TimelinePosition {
  source: TimelineSource;
  kind: TimelineKind;
  facilityId: string | null;
  /** The record the row is filed under (the patient, or a record merged into it). */
  patientId: string | null;
  draft: Draft;
}

const markerFor = (status: string | null): TimelineEntry["marker"] =>
  status === "entered_in_error" ? "entered_in_error" : status === "cancelled" ? "cancelled" : status === "void" ? "void" : null;

/**
 * Patient 360 timeline (CLAUDE.md §6, §39): one chronological view composed at the application layer from each
 * domain's read query, so no domain library depends on another. Each source returns at most one page (plus one)
 * after the cursor; the page is merged here. Kinds are gated by the domain's own read permission.
 */
@Injectable()
export class PatientTimelineService {
  constructor(
    private readonly patients: PatientRecordService,
    private readonly organizations: OrganizationService,
    private readonly clinic: ClinicQueries,
    private readonly prescriptions: PrescriptionService,
    private readonly lab: LabRecordQueries,
    private readonly dental: DentalRecordQueries,
    private readonly carePlans: CarePlanService,
    private readonly billing: BillingRecordQueries,
    private readonly notifications: NotificationService,
    private readonly documents: DocumentRecordQueries,
    private readonly immunizations: ImmunizationService,
    private readonly audit: AuditService,
  ) {}

  async timeline(actor: Actor, patientId: string, query: TimelineQuery): Promise<TimelinePage> {
    const organizationId = actor.organizationId;
    const briefs = await this.patients.briefs(organizationId, [patientId]);
    if (!briefs.has(patientId)) throw new NotFoundError("Patient");

    const facilities = await this.organizations.listFacilities(organizationId);
    const byId = new Map(facilities.map((f) => [f.id, f]));
    const filterFacility = query.facilityId ? byId.get(query.facilityId) : undefined;
    if (query.facilityId && !filterFacility) throw new NotFoundError("Facility");
    const timeZone = filterFacility?.timezone ?? (actor.facilityId ? byId.get(actor.facilityId)?.timezone : undefined) ?? PH_TIMEZONE;

    const from = query.from ? localDayBounds(query.from, timeZone).start : null;
    const to = query.to ? localDayBounds(query.to, timeZone).end : null;
    if (from && to && from >= to) throw new BadRequestError("`from` must not be after `to`", "invalid_date_range");
    const limit = query.limit ?? TIMELINE_PAGE_SIZE;
    const window: TimelineWindow = {
      before: query.cursor ? decodeCursor(query.cursor) : null,
      from,
      to,
      facilityIds: filterFacility ? [filterFacility.id] : null,
      limit: limit + 1,
    };

    const { included, withheld } = visibleKinds(actor.permissions, query.kinds);
    // Rows of records merged into this patient are included (ADR-0009) and carry the number they were filed under.
    const [sources, filedUnder] = await Promise.all([
      Promise.all(included.map((kind) => this.load(kind, organizationId, patientId, window))),
      this.patients.filedUnderNumbers(organizationId, patientId),
    ]);
    const { items, next } = mergePage(sources, limit);

    const entries = items.map((row): TimelineEntry => {
      const facility = row.facilityId ? byId.get(row.facilityId) : undefined;
      const { sourceIds, marker, flag, ...draft } = row.draft;
      return {
        id: `${row.source}:${row.id}`,
        kind: row.kind,
        occurredAt: row.at,
        facility: facility ? { id: facility.id, name: facility.name } : null,
        ...draft,
        marker: marker ?? markerFor(draft.status),
        flag: flag ?? null,
        filedUnder: row.patientId && row.patientId !== patientId ? (filedUnder.get(row.patientId) ?? null) : null,
        sourceIds: sourceIds ?? {},
      };
    });

    const counts = Object.fromEntries(included.map((k) => [k, entries.filter((e) => e.kind === k).length]));
    await this.audit.recordStandalone(actor, {
      action: "patient.timeline.view",
      resourceType: "patient",
      resourceId: patientId,
      patientId,
      metadata: {
        filters: {
          kinds: query.kinds ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          facilityId: query.facilityId ?? null,
          page: query.cursor ? "next" : "first",
        },
        counts,
        withheld,
      },
    });
    return { items: entries, nextCursor: next ? encodeCursor(next) : null, withheld, timeZone };
  }

  /** One kind's rows for the window, as positioned drafts. */
  private async load(kind: TimelineKind, organizationId: string, patientId: string, window: TimelineWindow): Promise<Row[]> {
    const row = (source: TimelineSource, r: { id: string; at: string; facilityId?: string | null; patientId?: string | null }, draft: Draft): Row => ({
      source,
      kind,
      id: r.id,
      at: r.at,
      facilityId: r.facilityId ?? null,
      patientId: r.patientId ?? null,
      draft,
    });
    switch (kind) {
      case "appointment":
        return (await this.clinic.timelineAppointments(organizationId, patientId, window)).map((a) =>
          row("appointment", a, {
            title: `Appointment: ${a.visitTypeName}`,
            detail: [a.practitionerName, a.modality === "telemedicine" ? "Online" : null, a.bookedByPatient ? "Booked by the patient" : null]
              .filter(Boolean)
              .join(" · "),
            status: a.status,
            link: { type: a.modality === "telemedicine" ? "telemedicine" : "appointment", id: a.id },
            sourceIds: { appointmentId: a.id, practitionerId: a.practitionerId },
          }),
        );
      case "encounter":
        return (await this.clinic.timelineEncounters(organizationId, patientId, window)).map((e) => {
          const uncoded = e.diagnosisCount - e.diagnosisCodes.length;
          const diagnoses = e.diagnosisCount
            ? `Diagnoses: ${[...e.diagnosisCodes, ...(uncoded > 0 ? [`${uncoded} uncoded`] : [])].join(", ")}`
            : "No diagnosis recorded";
          return row("encounter", e, {
            title: `${e.modality === "telemedicine" ? "Online consultation" : "Consultation"}${e.visitTypeName ? `: ${e.visitTypeName}` : ""}`,
            detail: [e.practitionerName, diagnoses].join(" · "),
            status: e.status,
            link: { type: "encounter", id: e.id },
            sourceIds: { encounterId: e.id, ...(e.appointmentId ? { appointmentId: e.appointmentId } : {}) },
          });
        });
      case "vitals":
        return (await this.clinic.timelineVitals(organizationId, patientId, window)).map((v) =>
          row("vitals", v, {
            title: "Vital signs recorded",
            detail: null,
            status: v.status,
            link: v.encounterId ? { type: "encounter", id: v.encounterId } : { type: "patient_record", id: patientId },
            sourceIds: { vitalSignSetId: v.id, ...(v.encounterId ? { encounterId: v.encounterId } : {}), ...(v.visitId ? { visitId: v.visitId } : {}) },
          }),
        );
      case "prescription":
        return (await this.prescriptions.timeline(organizationId, patientId, window)).map((p) =>
          row("prescription", p, {
            title: `Prescription ${p.prescriptionNumber}`,
            detail: p.medicines.length ? summarizeNames(p.medicines) : null,
            status: p.status,
            link: { type: "encounter", id: p.encounterId },
            sourceIds: { prescriptionId: p.id, encounterId: p.encounterId },
          }),
        );
      case "lab_order":
        return (await this.lab.timelineOrders(organizationId, patientId, window)).map((o) =>
          row("lab_order", o, {
            title: `Laboratory order ${o.orderNumber}`,
            detail: [
              o.tests.length ? `${summarizeNames(o.tests)} (${plural(o.tests.length, "test")})` : null,
              o.priority !== "routine" ? humanize(o.priority) : null,
            ]
              .filter(Boolean)
              .join(" · "),
            status: o.status,
            link: o.encounterId ? { type: "encounter", id: o.encounterId } : { type: "patient_laboratory", id: patientId },
            sourceIds: { labOrderId: o.id, ...(o.encounterId ? { encounterId: o.encounterId } : {}) },
          }),
        );
      case "lab_result_release":
        return (await this.lab.timelineReleases(organizationId, patientId, window)).map((r) =>
          row("lab_result_release", r, {
            title: `${r.correction ? "Corrected results released" : "Results released"}: ${summarizeNames(r.tests)} (${plural(r.tests.length, "test")})`,
            detail: `Order ${r.orderNumber}`,
            status: r.superseded ? "superseded" : "released",
            flag: r.critical ? "critical" : r.abnormal ? "abnormal" : null,
            link: { type: "patient_laboratory", id: patientId },
            sourceIds: { labOrderId: r.orderId, labResultId: r.id },
          }),
        );
      case "dental": {
        const [exams, procedures, plans] = await Promise.all([
          this.dental.timelineExaminations(organizationId, patientId, window),
          this.dental.timelineProcedures(organizationId, patientId, window),
          this.dental.timelinePlanDecisions(organizationId, patientId, window),
        ]);
        const link = { type: "dental_record" as const, id: patientId };
        return [
          ...exams.map((e) =>
            row("dental_exam", e, {
              title: "Dental examination",
              detail: null,
              status: e.status,
              link,
              sourceIds: { dentalExaminationId: e.id, encounterId: e.encounterId },
            }),
          ),
          ...procedures.map((p) =>
            row("dental_procedure", p, {
              title: `Dental procedure: ${p.name}`,
              detail: `Code ${p.code}`,
              status: p.status,
              link,
              sourceIds: { dentalProcedureId: p.id, encounterId: p.encounterId },
            }),
          ),
          ...plans.map((p) =>
            row("dental_plan", p, {
              title: `Treatment plan decision recorded: ${p.title}`,
              detail: null,
              status: p.status,
              link,
              sourceIds: { treatmentPlanId: p.id },
            }),
          ),
        ];
      }
      case "care_plan": {
        const [plans, activities] = await Promise.all([
          this.carePlans.timelinePlans(organizationId, patientId, window),
          this.carePlans.timelineCompletedActivities(organizationId, patientId, window),
        ]);
        return [
          ...plans.map((c) =>
            row("care_plan", c, {
              title: `Care plan created: ${c.title}`,
              detail: humanize(c.category),
              status: c.status,
              link: { type: "care_plan", id: c.id },
              sourceIds: { carePlanId: c.id },
            }),
          ),
          ...activities.map((a) =>
            row("care_plan_activity", a, {
              title: `Care plan activity completed: ${humanize(a.kind)}`,
              detail: null,
              status: a.status,
              link: { type: "care_plan", id: a.carePlanId },
              sourceIds: { carePlanId: a.carePlanId, activityId: a.id },
            }),
          ),
        ];
      }
      case "invoice":
        return (await this.billing.timelineInvoices(organizationId, patientId, window)).map((i) =>
          row("invoice", i, {
            title: i.invoiceNumber ? `Invoice ${i.invoiceNumber} issued` : "Invoice issued",
            detail: `Total ${formatPeso(i.netTotal)}`,
            status: i.status,
            link: { type: "invoice", id: i.id },
            sourceIds: { invoiceId: i.id },
          }),
        );
      case "payment":
        return (await this.billing.timelinePayments(organizationId, patientId, window)).map((p) =>
          row("payment", p, {
            title: `${p.kind === "refund" ? "Refund" : "Payment"} ${formatPeso(p.amount)}`,
            detail: [humanize(p.method), p.receiptNumber ? `Receipt ${p.receiptNumber}` : null, p.invoiceNumber ? `Invoice ${p.invoiceNumber}` : null]
              .filter(Boolean)
              .join(" · "),
            status: p.kind,
            link: { type: "invoice", id: p.invoiceId },
            sourceIds: { paymentId: p.id, invoiceId: p.invoiceId },
          }),
        );
      case "communication":
        return (await this.notifications.timelineForPatient(organizationId, patientId, window)).map((n) =>
          row("communication", n, {
            title: `${CHANNEL_LABELS[n.channel] ?? humanize(n.channel)}: ${humanize(n.templateKey)}`,
            detail: `${humanize(n.category)} message`,
            status: n.status,
            link: null,
            sourceIds: { notificationId: n.id },
          }),
        );
      case "external_history":
        return (await this.clinic.timelineExternalHistory(organizationId, patientId, window)).map((x) =>
          row("external_history", x, {
            title: `Imported ${x.kind} (external record)`,
            detail:
              [x.code ? `${x.codeSystem ? `${x.codeSystem} ` : ""}${x.code}` : null, x.declaredSource ? `From ${x.declaredSource}` : null]
                .filter(Boolean)
                .join(" · ") || null,
            status: x.status,
            link: { type: "patient_external_history", id: patientId },
            sourceIds: { externalHistoryEntryId: x.id },
          }),
        );
      case "immunization":
        return (await this.immunizations.timeline(organizationId, patientId, window)).map((i) =>
          row("immunization", i, {
            title: `${i.status === "not_done" ? "Immunization not given" : IMMUNIZATION_TITLE[i.source]}: ${i.vaccineName}`,
            detail:
              [doseText(i), i.occurredAt ? null : `Given ${occurrenceText({ date: i.occurrenceDate, precision: i.occurrencePrecision, at: null })}`]
                .filter(Boolean)
                .join(" · ") || null,
            status: i.enteredInErrorAt ? "entered_in_error" : i.status,
            link: { type: "patient_immunizations", id: patientId },
            sourceIds: { immunizationId: i.id, ...(i.encounterId ? { encounterId: i.encounterId } : {}) },
          }),
        );
      case "document":
        return (await this.documents.timeline(organizationId, patientId, window)).map((d) =>
          row("document", d, {
            title: `Document added: ${humanize(d.category)}`,
            detail: null,
            status: "available",
            link: null,
            sourceIds: { documentId: d.id },
          }),
        );
    }
  }
}

const IMMUNIZATION_TITLE: Record<string, string> = {
  administered_here: "Immunization given",
  historical: "Immunization reported",
  external_import: "Immunization imported (external record)",
};

const CHANNEL_LABELS: Record<string, string> = { sms: "SMS", email: "Email", push: "Push notification", in_app: "MyHealth message" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
