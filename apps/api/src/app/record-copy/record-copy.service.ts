import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ClinicQueries, MedicalCertificateService, type MedicalCertificateView } from "@healthcare/clinic";
import type { Actor } from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import type { PatientRecordSource } from "@healthcare/interoperability";
import { OrganizationService } from "@healthcare/organization";
import { type PrepareRecordCopyDto, RECORD_COPY_SECTIONS, type RecordCopySection, RecordsRequestService } from "@healthcare/patient";
import { facilityLetterhead, type Letterhead, pdfDate, pdfDateTime, type PdfWriter, renderPdf } from "@healthcare/pdf";
import { FhirRecordComposer } from "../fhir/fhir-record";
import {
  type CopyPeriod,
  dateInPeriod,
  flagLabel,
  instantInPeriod,
  occurrenceLabel,
  occurrenceSpan,
  periodLabel,
  referenceRange,
  resultValue,
  spanOverlapsPeriod,
} from "./record-copy.rules";

const DEFAULT_TIME_ZONE = "Asia/Manila";

const SECTION_TITLES: Record<RecordCopySection, string> = {
  allergies: "Allergies",
  consultations: "Consultations",
  laboratory: "Laboratory results",
  prescriptions: "Prescriptions",
  care_plans: "Care plans",
  dental: "Dental treatment",
  certificates: "Medical certificates",
  documents: "Documents on file",
  immunizations: "Immunizations",
};

type SignedNotes = Awaited<ReturnType<ClinicQueries["signedNotes"]>>;

interface CopyContent {
  record: PatientRecordSource;
  notes: SignedNotes;
  certificates: MedicalCertificateView[];
}

/**
 * A copy of the patient's record for a records request (docs/domains/records-requests.md, "Copy of the record"): the
 * records office chooses the sections and the period; the record is composed from each domain's read query (as for the
 * FHIR export, plus the signed consultation notes and issued medical certificates), rendered to one PDF and stored once
 * as a `record_copy` document of the patient, which is then shared in answer like any other document. Only the
 * record as it stands is copied: released laboratory results, signed notes (the latest signed or amended version),
 * issued certificates; entries in error, drafts and consultations still in progress are left out. The request answers
 * the patient's own ask, so the copy includes the dental record and document list whatever the preparer's own
 * clinical access (the copy is audited, and nothing reaches the patient until it is shared).
 */
@Injectable()
export class RecordCopyService {
  constructor(
    private readonly requests: RecordsRequestService,
    private readonly composer: FhirRecordComposer,
    private readonly clinic: ClinicQueries,
    private readonly certificates: MedicalCertificateService,
    private readonly organizations: OrganizationService,
    private readonly documents: DocumentsService,
  ) {}

  async prepare(actor: Actor, requestId: string, input: PrepareRecordCopyDto) {
    const request = await this.requests.copyTarget(actor, requestId);
    const sections = RECORD_COPY_SECTIONS.filter((s) => input.sections.includes(s));
    const [organization, facility] = await Promise.all([
      this.organizations.getOrganization(actor.organizationId),
      actor.facilityId ? this.organizations.getFacility(actor.organizationId, actor.facilityId) : Promise.resolve(null),
    ]);
    const timeZone = facility?.timezone ?? DEFAULT_TIME_ZONE;
    const [record, notes, certificates] = await Promise.all([
      this.composer.record(actor, request.patientId, { documents: true, dental: true }),
      sections.includes("consultations") ? this.clinic.signedNotes(actor.organizationId, request.patientId) : Promise.resolve(new Map() as SignedNotes),
      sections.includes("certificates") ? this.certificates.issuedForPatient(actor.organizationId, request.patientId) : Promise.resolve([]),
    ]);
    const now = new Date();
    const period: CopyPeriod = { from: input.periodFrom ?? null, to: input.periodTo ?? null };
    const body = await renderPdf(
      {
        title: "Copy of Medical Records",
        subtitle: `Prepared for records request ${request.requestNumber}`,
        letterhead: facility ? facilityLetterhead(organization.name, facility) : ({ organizationName: organization.name } satisfies Letterhead),
        printedAt: `Prepared ${pdfDateTime(now, timeZone)}`,
        footerNote: `Copy of records for request ${request.requestNumber}, prepared at the patient's request. Confidential: personal health information.`,
      },
      (w) => {
        cover(w, record, { requestNumber: request.requestNumber, sections, period, preparedBy: actor.displayName, preparedAt: pdfDateTime(now, timeZone) });
        const content: CopyContent = { record, notes, certificates };
        for (const section of sections) {
          w.heading(SECTION_TITLES[section]);
          RENDERERS[section](w, content, period, timeZone);
        }
      },
    );
    const documentId = randomUUID();
    const stored = await this.documents.storeGenerated(
      actor,
      {
        id: documentId,
        facilityId: facility?.id ?? null,
        patientId: request.patientId,
        category: "record_copy",
        title: `Copy of records ${request.requestNumber} (${pdfDateTime(now, timeZone)})`,
        fileName: `records-${request.requestNumber}-${documentId.slice(0, 8)}.pdf`,
        contentType: "application/pdf",
        body,
      },
      (tx) => this.requests.recordCopy(tx, actor, request, documentId, { sections, periodFrom: input.periodFrom, periodTo: input.periodTo }),
    );
    return {
      documentId: stored.id,
      title: stored.title,
      fileName: stored.fileName,
      sections,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      createdAt: stored.createdAt,
    };
  }
}

function cover(
  w: PdfWriter,
  record: PatientRecordSource,
  copy: { requestNumber: string; sections: RecordCopySection[]; period: CopyPeriod; preparedBy: string; preparedAt: string },
) {
  const p = record.patient;
  const name = `${p.familyName.toUpperCase()}, ${[p.givenName, p.middleName, p.suffix].filter(Boolean).join(" ")}`;
  w.fields([
    ["Patient", name],
    ["Patient number", p.patientNumber],
    ["Date of birth", pdfDate(p.birthDate)],
    ["Sex", p.sex],
    ["Records request", copy.requestNumber],
    ["Period", periodLabel(copy.period, (d) => pdfDate(d))],
    ["Contents", copy.sections.map((s) => SECTION_TITLES[s]).join(", ")],
    ["Prepared by", `${copy.preparedBy}, ${copy.preparedAt}`],
  ]);
  w.paragraph(
    "This copy shows the record as it stood when it was prepared: signed consultation notes (as last amended), released laboratory results and issued certificates. Drafts, consultations still in progress and entries marked as made in error are not included. Records received from other providers are labelled as such.",
    { muted: true, size: 8.5 },
  );
}

type Renderer = (w: PdfWriter, content: CopyContent, period: CopyPeriod, timeZone: string) => void;

const none = (w: PdfWriter, what: string): void => {
  w.paragraph(`No ${what} in this period.`, { muted: true });
};

const RENDERERS: Record<RecordCopySection, Renderer> = {
  // The current list, whatever the period: allergies are what care today must know.
  allergies: (w, { record }, _period, timeZone) => {
    const allergies = record.allergies.filter((a) => a.status === "active");
    if (!allergies.length) {
      w.paragraph(
        record.allergyReview?.noKnownAllergies
          ? `No known allergies (reviewed ${pdfDate(new Date(record.allergyReview.reviewedAt), timeZone)}).`
          : "No allergies recorded. Allergies may not have been reviewed.",
      );
      return;
    }
    w.table(
      [
        { header: "Substance", width: 3 },
        { header: "Reaction", width: 3 },
        { header: "Severity", width: 1.5 },
        { header: "Status", width: 2.5 },
      ],
      allergies.map((a) => [
        a.substance,
        a.reaction ?? "",
        a.severity ?? "",
        [a.verification === "confirmed" ? "Confirmed" : "Unconfirmed", a.source === "external_import" ? "from another provider" : null]
          .filter(Boolean)
          .join(", "),
      ]),
    );
  },

  consultations: (w, { record, notes }, period, timeZone) => {
    const practitioners = new Map(record.practitioners.map((p) => [p.id, p]));
    const facilities = new Map(record.facilities.map((f) => [f.id, f.name]));
    const encounters = record.encounters.filter((e) => e.status === "completed" && instantInPeriod(e.startedAt, period, timeZone));
    if (!encounters.length) return none(w, "consultations");
    for (const e of encounters) {
      const clinician = practitioners.get(e.practitionerId);
      w.paragraph(
        `${localDay(e.startedAt, timeZone)} · ${e.modality === "telemedicine" ? "Online consultation" : (e.visitTypeName ?? "Consultation")} · ${facilities.get(e.facilityId) ?? ""}`,
        { bold: true },
      );
      w.fields(
        [
          ["Clinician", clinician ? `${clinician.displayName}${clinician.licenseNumber ? ` (PRC ${clinician.licenseNumber})` : ""}` : null],
          ["Chief complaint", e.chiefComplaint],
        ],
        2,
      );
      const vitals = record.vitals.filter((v) => v.encounterId === e.id && v.status === "final");
      for (const v of vitals) w.paragraph(`Vital signs: ${vitalsLine(v)}`, { size: 9 });
      const diagnoses = record.diagnoses.filter((d) => d.encounterId === e.id && d.status !== "entered_in_error");
      if (diagnoses.length) {
        w.table(
          [
            { header: "Diagnosis", width: 5 },
            { header: "Code", width: 1.5 },
            { header: "Certainty", width: 1.5 },
            { header: "Rank", width: 1.5 },
          ],
          diagnoses.map((d) => [d.display, d.code ?? "", d.certainty, d.rank]),
        );
      }
      const note = notes.get(e.id);
      if (note) {
        const parts: Array<[string, string | null]> = [
          ["Subjective", note.subjective],
          ["Objective", note.objective],
          ["Assessment", note.assessment],
          ["Plan", note.plan],
        ];
        for (const [label, text] of parts) if (text?.trim()) w.paragraph(`${label}: ${text.trim()}`);
        if (note.kind === "amendment") w.paragraph(`Note amended ${pdfDateTime(note.authoredAt, timeZone)}.`, { muted: true, size: 8.5 });
      }
      w.space(0.8);
    }
  },

  laboratory: (w, { record }, period, timeZone) => {
    const rows = record.labOrders.flatMap((o) =>
      o.items.filter((i) => i.result && instantInPeriod(i.result.releasedAt, period, timeZone)).map((i) => ({ order: o, item: i, result: i.result! })),
    );
    if (!rows.length) return none(w, "released laboratory results");
    w.table(
      [
        { header: "Released", width: 1.6 },
        { header: "Order", width: 1.6 },
        { header: "Test", width: 3 },
        { header: "Result", width: 2 },
        { header: "Reference range", width: 1.8 },
        { header: "Flag", width: 1.4 },
      ],
      rows.map(({ order, item, result }) => [
        localDay(result.releasedAt!, timeZone),
        order.orderNumber,
        result.performer ? `${item.testName} (performed by ${result.performer.name})` : item.testName,
        [resultValue(result), result.comment].filter(Boolean).join(". "),
        referenceRange(result),
        flagLabel(result.flag),
      ]),
    );
  },

  prescriptions: (w, { record }, period, timeZone) => {
    const practitioners = new Map(record.practitioners.map((p) => [p.id, p.displayName]));
    const prescriptions = record.prescriptions.filter((p) => instantInPeriod(p.issuedAt, period, timeZone));
    if (!prescriptions.length) return none(w, "prescriptions");
    for (const p of prescriptions) {
      w.paragraph(
        `${p.prescriptionNumber} · ${localDay(p.issuedAt, timeZone)} · ${practitioners.get(p.prescriberPractitionerId) ?? ""}${p.status === "active" ? "" : ` · ${p.status}`}`,
        { bold: true },
      );
      w.table(
        [
          { header: "Medicine", width: 4 },
          { header: "How to take", width: 4 },
          { header: "Quantity", width: 1.5 },
        ],
        p.items.map((i) => [
          [i.genericName, i.brandName ? `(${i.brandName})` : null, i.strength, i.dosageForm].filter(Boolean).join(" "),
          [
            i.doseAmount !== null ? `${i.doseAmount} ${i.doseUnit ?? ""}`.trim() : null,
            i.route,
            i.frequencyText ?? i.frequency,
            i.durationValue ? `for ${i.durationValue} ${i.durationUnit ?? ""}`.trim() : null,
            i.instructions,
          ]
            .filter(Boolean)
            .join(", "),
          i.quantity !== null ? `${i.quantity} ${i.quantityUnit ?? ""}`.trim() : "",
        ]),
      );
    }
  },

  care_plans: (w, { record }, period) => {
    const plans = record.carePlans.filter((c) => c.status !== "draft" && spanOverlapsPeriod(c.startDate, c.endDate, period));
    if (!plans.length) return none(w, "care plans");
    for (const c of plans) {
      w.paragraph(`${c.title} · ${c.status.replace("_", " ")} · from ${pdfDate(c.startDate)}${c.endDate ? ` to ${pdfDate(c.endDate)}` : ""}`, { bold: true });
      if (c.description) w.paragraph(c.description);
      const activities = c.activities.filter((a) => a.status !== "cancelled");
      if (activities.length) {
        w.table(
          [
            { header: "Activity", width: 5 },
            { header: "Due", width: 2 },
            { header: "Status", width: 2 },
          ],
          activities.map((a) => [a.description, a.dueDate ? pdfDate(a.dueDate) : "", a.status.replace("_", " ")]),
        );
      }
    }
  },

  dental: (w, { record }, period, timeZone) => {
    const dental = record.dental;
    const procedures = (dental?.procedures ?? []).filter((p) => p.status === "recorded" && instantInPeriod(p.performedAt, period, timeZone));
    const plans = (dental?.plans ?? []).filter((p) => instantInPeriod(p.createdAt, period, timeZone));
    if (!procedures.length && !plans.length) return none(w, "dental treatment");
    if (procedures.length) {
      w.paragraph("Procedures done", { bold: true });
      w.table(
        [
          { header: "Date", width: 1.6 },
          { header: "Procedure", width: 4 },
          { header: "Tooth", width: 1 },
          { header: "Surfaces", width: 1.2 },
        ],
        procedures.map((p) => [localDay(p.performedAt, timeZone), `${p.name} (${p.code})`, p.tooth ?? "", p.surfaces.join(" ")]),
      );
    }
    for (const plan of plans) {
      w.paragraph(`Treatment plan: ${plan.title} · ${plan.status.replace("_", " ")} · ${localDay(plan.createdAt, timeZone)}`, { bold: true });
      w.table(
        [
          { header: "Phase", width: 0.8 },
          { header: "Procedure", width: 4 },
          { header: "Tooth", width: 1 },
          { header: "Status", width: 1.5 },
        ],
        plan.items.map((i) => [String(i.phase), `${i.name} (${i.code})`, [i.tooth, i.surfaces.join("")].filter(Boolean).join(" "), i.status]),
      );
    }
  },

  certificates: (w, { certificates }, period) => {
    const issued = certificates.filter((c) => dateInPeriod(c.examinedOn, period));
    if (!issued.length) return none(w, "medical certificates");
    w.table(
      [
        { header: "Certificate", width: 1.8 },
        { header: "Examined", width: 1.6 },
        { header: "Purpose", width: 3 },
        { header: "Issued by", width: 2.4 },
      ],
      issued.map((c) => [c.certificateNumber, pdfDate(c.examinedOn), c.purpose, c.practitionerName ?? ""]),
    );
    w.paragraph("Each certificate is a separate document; ask the records office for a copy of any listed here.", { muted: true, size: 8.5 });
  },

  documents: (w, { record }, period, timeZone) => {
    // Earlier copies of the record are not listed in a new one.
    const documents = (record.documents ?? []).filter((d) => d.category !== "record_copy" && instantInPeriod(d.uploadedAt, period, timeZone));
    if (!documents.length) return none(w, "documents");
    w.table(
      [
        { header: "Date", width: 1.6 },
        { header: "Document", width: 5 },
        { header: "Kind", width: 2 },
      ],
      documents.map((d) => [localDay(d.uploadedAt, timeZone), d.title, d.category.replace(/_/g, " ")]),
    );
    w.paragraph("Files (reports, images, scans) are shared as separate documents.", { muted: true, size: 8.5 });
  },

  immunizations: renderImmunizations,
};

const SOURCE_LABEL: Record<string, string> = { administered_here: "Given here", historical: "Reported", external_import: "From another provider" };
const NOT_GIVEN: Record<string, string> = { refused: "refused", contraindicated: "contraindicated", unavailable: "vaccine unavailable", other: "other reason" };

// Doses given in the period (a dose recorded only by year or month counts when that year or month overlaps it); doses
// not given are listed as such with the kind of reason; entries in error are left out. Staff notes are not copied.
function renderImmunizations(w: PdfWriter, { record }: CopyContent, period: CopyPeriod, timeZone: string): void {
  const facilities = new Map(record.facilities.map((f) => [f.id, f.name]));
  const doses = record.immunizations.filter((i) => {
    if (i.enteredInErrorAt) return false;
    const span = occurrenceSpan(i.occurrenceDate, i.occurrencePrecision);
    return spanOverlapsPeriod(span.start, span.end, period);
  });
  if (!doses.length) {
    none(w, "immunizations");
    return;
  }
  w.table(
    [
      { header: "Date given", width: 1.6 },
      { header: "Vaccine", width: 3 },
      { header: "Dose", width: 1.2 },
      { header: "Where / by", width: 2.4 },
      { header: "Lot", width: 1.3 },
      { header: "Record", width: 1.8 },
    ],
    doses.map((i) => [
      i.occurredAt ? localDay(i.occurredAt, timeZone) : occurrenceLabel(i.occurrenceDate, i.occurrencePrecision, (d) => pdfDate(d)),
      i.vaccineName,
      i.doseLabel ?? (i.doseNumber !== null ? String(i.doseNumber) : ""),
      (i.facilityId ? facilities.get(i.facilityId) : null) ?? i.performerName ?? "",
      i.lotNumber ?? "",
      i.status === "not_done" ? `Not given (${NOT_GIVEN[i.notDoneReason ?? "other"] ?? "other reason"})` : (SOURCE_LABEL[i.source] ?? i.source),
    ]),
  );
  w.paragraph("Doses reported by the patient or received from other providers are labelled as such.", { muted: true, size: 8.5 });
}

function vitalsLine(v: PatientRecordSource["vitals"][number]): string {
  return [
    v.systolicMmhg !== null && v.diastolicMmhg !== null ? `BP ${v.systolicMmhg}/${v.diastolicMmhg} mmHg` : null,
    v.heartRateBpm !== null ? `HR ${v.heartRateBpm}/min` : null,
    v.respiratoryRateBpm !== null ? `RR ${v.respiratoryRateBpm}/min` : null,
    v.temperatureC !== null ? `Temp ${v.temperatureC} C` : null,
    v.spo2Percent !== null ? `SpO2 ${v.spo2Percent}%` : null,
    v.weightKg !== null ? `Wt ${v.weightKg} kg` : null,
    v.heightCm !== null ? `Ht ${v.heightCm} cm` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** An instant (ISO string) as its local date in the facility's time zone. */
function localDay(at: string, timeZone: string): string {
  return pdfDate(new Date(at), timeZone);
}
