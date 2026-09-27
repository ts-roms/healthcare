import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, type Letterhead, pdfDate, pdfDateTime, renderPdf } from "@healthcare/pdf";
import { and, asc, eq, inArray } from "drizzle-orm";
import { LabReadModel } from "../lab-read-model";
import { labOrder, labOrderItem, labResult, labSpecimen } from "../laboratory.schema";
import { found } from "../laboratory-support";
import { LabOrderService } from "../orders/lab-order.service";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { LabPatientAccess } from "./lab-patient-access";

type Flag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal" | null;

export interface LabReportRow {
  test: string;
  result: string;
  unit: string | null;
  reference: string;
  flag: Flag;
  collectedAt: Date | null;
  releasedAt: Date | null;
  corrected: boolean;
  comment?: string | null;
}

export interface LabReportData {
  letterhead: Letterhead;
  timeZone: string;
  orderNumber: string;
  orderedAt: Date;
  orderedBy: string | null;
  patient: { name: string; number: string; sex: string; age: number | null; birthDate: string | null };
  rows: LabReportRow[];
  /** Tests of the order without a released result (staff copy). */
  pending: string[];
  /** The patient's copy leaves out some tests of the order (not named). */
  withheld?: boolean;
  signatories: Array<{ name: string; role: string }>;
  copy: "staff" | "patient" | "archive";
  /** Archived copies: which archived version of the order's report this is. */
  archiveVersion?: number;
}

const FLAG_LABEL: Record<Exclude<Flag, null>, string> = {
  normal: "",
  low: "L  Low",
  high: "H  High",
  critical_low: "LL Critical low",
  critical_high: "HH Critical high",
  abnormal: "A  Abnormal",
};

export function referenceText(r: { refLow: number | null; refHigh: number | null; refText: string | null }): string {
  if (r.refLow !== null && r.refHigh !== null) return `${r.refLow} - ${r.refHigh}`;
  if (r.refHigh !== null) return `<= ${r.refHigh}`;
  if (r.refLow !== null) return `>= ${r.refLow}`;
  return r.refText ?? "";
}

export function resultText(r: { resultType: string; valueNumeric: number | null; valueText: string | null; valueCoded: string | null }): string {
  if (r.resultType === "numeric") return r.valueNumeric === null ? "" : String(r.valueNumeric);
  return (r.resultType === "coded" ? r.valueCoded : r.valueText) ?? "";
}

/**
 * Printable laboratory result reports (PDF). Only released results are
 * printed; released results are immutable, so a report can be regenerated
 * identically at any time (a corrected result prints as corrected). The
 * patient's copy follows the portal's rules: only results the patient may see,
 * no staff names or internal comments.
 */
@Injectable()
export class LabReportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: LabOrderService,
    private readonly patientAccess: LabPatientAccess,
    private readonly organizations: OrganizationService,
    private readonly readModel: LabReadModel,
    private readonly audit: AuditService,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
  ) {}

  async staffReport(actor: Actor, orderId: string): Promise<{ filename: string; pdf: Buffer }> {
    const order = await this.orders.get(actor, orderId);
    const released = order.items.filter((i) => i.result?.status === "released");
    const specimen = (id: string | null) => order.specimens.find((s) => s.id === id);
    const data: LabReportData = {
      ...(await this.frame(actor.organizationId, order.facilityId, order.patientId)),
      orderNumber: order.orderNumber,
      orderedAt: order.orderedAt,
      orderedBy: order.orderingPractitionerName ?? order.externalOrderer ?? null,
      rows: released.map((i) => {
        const r = i.result!;
        return {
          test: i.testName,
          result: resultText(r),
          unit: r.unit,
          reference: referenceText(r),
          flag: r.flag,
          collectedAt: specimen(i.specimenId)?.collectedAt ?? null,
          releasedAt: r.releasedAt,
          corrected: r.versionNumber > 1,
          comment: [r.comment, r.versionNumber > 1 && r.correctionReason ? `Corrected: ${r.correctionReason}` : null].filter(Boolean).join(" · ") || null,
        };
      }),
      pending: order.items.filter((i) => i.status !== "cancelled" && i.result?.status !== "released").map((i) => i.testName),
      signatories: signatories(released.map((i) => i.result!)),
      copy: "staff",
    };
    const pdf = await renderLabReport(data);
    await this.audit.recordStandalone(actor, {
      action: "lab.report.print",
      resourceType: "lab_order",
      resourceId: orderId,
      patientId: order.patientId,
      metadata: { results: data.rows.length },
    });
    return { filename: `${order.orderNumber}.pdf`, pdf };
  }

  /** The patient's copy from MyHealth: their own order, visible results only. */
  async patientReport(
    organizationId: string,
    patientId: string,
    orderId: string,
    auditContext: PatientAuditContext,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const [order] = await this.db
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.id, orderId), eq(labOrder.patientId, patientId)));
    if (!order) throw new NotFoundError("Laboratory order");
    const visible = await this.patientAccess.orderResults(organizationId, patientId, orderId);
    if (visible.length === 0) throw new NotFoundError("Laboratory report");
    const items = await this.db
      .select({ testName: labOrderItem.testName, status: labOrderItem.status })
      .from(labOrderItem)
      .where(eq(labOrderItem.orderId, orderId))
      .orderBy(asc(labOrderItem.testName));
    const shown = new Set(visible.map((v) => v.testName));
    const names = order.orderingPractitionerId
      ? await this.context.practitionerNames(organizationId, [order.orderingPractitionerId])
      : new Map<string, string>();
    const data: LabReportData = {
      ...(await this.frame(organizationId, order.facilityId, patientId)),
      orderNumber: order.orderNumber,
      orderedAt: order.orderedAt,
      orderedBy: (order.orderingPractitionerId ? names.get(order.orderingPractitionerId) : order.externalOrderer) ?? null,
      rows: visible.map((r) => ({
        test: r.testName,
        result: resultText(r),
        unit: r.unit,
        reference: referenceText(r),
        flag: r.flag,
        collectedAt: r.collectedAt,
        releasedAt: r.releasedAt,
        corrected: r.corrected,
      })),
      // Never name tests the patient is not shown (e.g. results the laboratory does not release to patients).
      pending: [],
      withheld: items.some((i) => i.status !== "cancelled" && !shown.has(i.testName)),
      signatories: [],
      copy: "patient",
    };
    const pdf = await renderLabReport(data);
    await this.audit.recordStandalone(auditContext, {
      action: "portal.lab-report-download",
      resourceType: "lab_order",
      resourceId: orderId,
      patientId,
      metadata: { results: data.rows.length },
    });
    return { filename: `${order.orderNumber}.pdf`, pdf };
  }

  /**
   * The report exactly as it stood when these result versions were released (for the archive; not audited here —
   * the archive records its own events). Results are immutable once released, so the same set always renders the
   * same report.
   */
  async archivedReport(organizationId: string, orderId: string, resultIds: string[], archiveVersion: number): Promise<{ filename: string; pdf: Buffer }> {
    const [row] = await this.db
      .select()
      .from(labOrder)
      .where(and(eq(labOrder.organizationId, organizationId), eq(labOrder.id, orderId)));
    const order = found(row, "Laboratory order");
    const results = await this.db
      .select()
      .from(labResult)
      .where(and(eq(labResult.organizationId, organizationId), eq(labResult.orderId, orderId), inArray(labResult.id, resultIds)));
    if (results.length !== resultIds.length || results.some((r) => !r.releasedAt)) throw new NotFoundError("Released laboratory result");
    const [items, specimens, views, names] = await Promise.all([
      this.db.select().from(labOrderItem).where(eq(labOrderItem.orderId, orderId)).orderBy(asc(labOrderItem.testName)),
      this.db.select({ id: labSpecimen.id, collectedAt: labSpecimen.collectedAt }).from(labSpecimen).where(eq(labSpecimen.orderId, orderId)),
      this.readModel.results(organizationId, results),
      order.orderingPractitionerId
        ? this.context.practitionerNames(organizationId, [order.orderingPractitionerId])
        : Promise.resolve(new Map<string, string>()),
    ]);
    const byItem = new Map(views.map((r) => [r.orderItemId, r]));
    const shown = items.filter((i) => byItem.has(i.id));
    const data: LabReportData = {
      ...(await this.frame(organizationId, order.facilityId, order.patientId)),
      orderNumber: order.orderNumber,
      orderedAt: order.orderedAt,
      orderedBy: (order.orderingPractitionerId ? names.get(order.orderingPractitionerId) : order.externalOrderer) ?? null,
      rows: shown.map((i) => {
        const r = byItem.get(i.id)!;
        return {
          test: i.testName,
          result: resultText(r),
          unit: r.unit,
          reference: referenceText(r),
          flag: r.flag,
          collectedAt: specimens.find((s) => s.id === i.specimenId)?.collectedAt ?? null,
          releasedAt: r.releasedAt,
          corrected: r.versionNumber > 1,
          comment: [r.comment, r.versionNumber > 1 && r.correctionReason ? `Corrected: ${r.correctionReason}` : null].filter(Boolean).join(" · ") || null,
        };
      }),
      // Tests of the order without a released result in this version (cancelled tests are not listed).
      pending: items.filter((i) => i.status !== "cancelled" && !byItem.has(i.id)).map((i) => i.testName),
      signatories: signatories(views),
      copy: "archive",
      archiveVersion,
    };
    return { filename: `${order.orderNumber}-v${archiveVersion}.pdf`, pdf: await renderLabReport(data) };
  }

  private async frame(organizationId: string, facilityId: string, patientId: string) {
    const [organization, facility, briefs, demographics] = await Promise.all([
      this.organizations.getOrganization(organizationId),
      this.organizations.getFacility(organizationId, facilityId),
      this.context.patientBriefs(organizationId, [patientId]),
      this.context.patientDemographics(organizationId, patientId),
    ]);
    const brief = briefs.get(patientId);
    return {
      letterhead: facilityLetterhead(organization.name, facility),
      timeZone: facility.timezone,
      patient: {
        name: brief?.displayName ?? "Patient",
        number: brief?.patientNumber ?? "",
        sex: brief?.sex ?? demographics?.sex ?? "",
        age: brief?.age ?? null,
        birthDate: demographics?.birthDate ?? null,
      },
    };
  }
}

function signatories(results: Array<{ verifiedByName: string | null; approvedByName: string | null }>) {
  const people: Array<{ name: string; role: string }> = [];
  for (const [key, role] of [
    ["verifiedByName", "Verified by (medical technologist)"],
    ["approvedByName", "Approved by (pathologist)"],
  ] as const) {
    for (const name of new Set(results.map((r) => r[key]).filter((n): n is string => Boolean(n)))) people.push({ name, role });
  }
  return people.slice(0, 4);
}

/** Lays out a laboratory report. */
export function renderLabReport(data: LabReportData): Promise<Buffer> {
  const tz = data.timeZone;
  const printed = `${data.copy === "archive" ? "Archived" : "Printed"} ${pdfDateTime(new Date(), tz)}`;
  return renderPdf(
    {
      title: "Laboratory Result Report",
      subtitle:
        data.copy === "patient"
          ? "Patient's copy from MyHealth"
          : data.copy === "archive"
            ? `Archived copy, version ${data.archiveVersion ?? 1} of this order's report`
            : undefined,
      letterhead: data.letterhead,
      printedAt: printed,
      footerNote:
        "Results are interpreted by your doctor together with your history and examination. Reference ranges are the laboratory's; H/L = above/below range, HH/LL = critical.",
    },
    (w) => {
      w.fields(
        [
          ["Patient", data.patient.name],
          ["Patient number", data.patient.number],
          ["Sex / age", [capitalize(data.patient.sex), data.patient.age !== null ? `${data.patient.age} y` : null].filter(Boolean).join(" / ")],
          ["Date of birth", data.patient.birthDate ? pdfDate(data.patient.birthDate) : null],
          ["Order number", data.orderNumber],
          ["Ordered", pdfDateTime(data.orderedAt, tz)],
          ["Requesting physician", data.orderedBy],
        ],
        2,
      );
      w.space();
      w.table(
        [
          { header: "Test", width: 3 },
          { header: "Result", width: 1.6, align: "right" },
          { header: "Unit", width: 1.2 },
          { header: "Reference range", width: 1.8 },
          { header: "Flag", width: 1.6 },
          { header: "Collected", width: 1.8 },
        ],
        data.rows.map((r) => [
          r.corrected ? `${r.test} (corrected)` : r.test,
          r.result,
          r.unit ?? "",
          r.reference,
          r.flag ? FLAG_LABEL[r.flag] : "",
          r.collectedAt ? pdfDateTime(r.collectedAt, tz) : "",
        ]),
        { emphasis: data.rows.flatMap((r, i) => (r.flag && r.flag !== "normal" ? [i] : [])) },
      );
      const comments = data.rows.filter((r) => r.comment);
      if (comments.length) {
        w.heading("Comments");
        for (const r of comments) w.paragraph(`${r.test}: ${r.comment}`);
      }
      if (data.rows.some((r) => r.corrected)) {
        w.paragraph("A result marked (corrected) replaces an earlier released value; the laboratory keeps both.", { muted: true });
      }
      if (data.pending.length) {
        w.heading("Pending");
        w.paragraph(`${data.pending.join(", ")} — no released result yet.`, { muted: true });
      }
      if (data.withheld) {
        w.paragraph("Some tests of this order are not shown here: they are not yet released, or your doctor will discuss them with you.", { muted: true });
      }
      const released = data.rows.map((r) => r.releasedAt).filter((d): d is Date => d !== null);
      if (released.length) {
        w.space();
        w.paragraph(`Released ${pdfDateTime(new Date(Math.max(...released.map((d) => d.getTime()))), tz)}`, { muted: true });
      }
      w.signatures(data.signatories);
    },
  );
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
