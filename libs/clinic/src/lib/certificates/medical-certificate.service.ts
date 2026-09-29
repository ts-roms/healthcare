import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  ForbiddenError,
  localDate,
  NotFoundError,
  systemActor,
  filedAsPatient,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, pdfDate, pdfDateTime, renderPdf } from "@healthcare/pdf";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { issueCertificateSchema } from "../clinic.dto";
import { encounter, medicalCertificate, medicalCertificateNumberSequence, type MedicalCertificateRecord, practitioner } from "../clinic.schema";
import { found, publicView } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import { restDays } from "./medical-certificate.rules";

export type MedicalCertificateView = Omit<MedicalCertificateRecord, "organizationId"> & {
  practitionerName: string | null;
  /** Rest days, both ends included; null without a rest period. */
  restDays: number | null;
};

/**
 * Medical certificates (docs/domains/clinic.md, "Medical certificates"): issued from a signed consultation — in person
 * or online — by its responsible practitioner, in the practitioner's own words (purpose, findings, recommendations and
 * an optional rest period; the platform supplies no wording any agency requires). Numbered per organization
 * (MC########), immutable, voided with a reason. The printable copy is a generated document whose id is the
 * certificate's, so it is stored once, however often it is asked for; a voided certificate's document is archived.
 */
@Injectable()
export class MedicalCertificateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly organizations: OrganizationService,
    private readonly documents: DocumentsService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  async issue(actor: Actor, encounterId: string, input: z.infer<typeof issueCertificateSchema>): Promise<MedicalCertificateView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.id, encounterId)))
        .for("update");
      const consultation = found(row, "Encounter");
      if (consultation.status !== "completed") {
        throw new BusinessRuleError("A certificate is issued once the consultation is signed", "encounter_not_signed");
      }
      if (!clinician || clinician.id !== consultation.practitionerId) {
        throw new ForbiddenError("Only the consultation's responsible practitioner issues its certificates");
      }
      const facility = await this.organizations.getFacility(actor.organizationId, consultation.facilityId);
      const [counter] = await tx
        .insert(medicalCertificateNumberSequence)
        .values({ organizationId: actor.organizationId, nextValue: 1 })
        .onConflictDoUpdate({
          target: medicalCertificateNumberSequence.organizationId,
          set: { nextValue: sql`${medicalCertificateNumberSequence.nextValue} + 1` },
        })
        .returning({ value: medicalCertificateNumberSequence.nextValue });
      if (!counter) throw new Error("Could not allocate a certificate number");
      const [inserted] = await tx
        .insert(medicalCertificate)
        .values({
          organizationId: actor.organizationId,
          facilityId: consultation.facilityId,
          patientId: consultation.patientId,
          encounterId,
          practitionerId: consultation.practitionerId,
          certificateNumber: `MC${String(counter.value).padStart(8, "0")}`,
          examinedOn: localDate(consultation.startedAt, facility.timezone),
          purpose: input.purpose,
          findings: input.findings,
          recommendations: input.recommendations ?? null,
          restFrom: input.rest?.from ?? null,
          restTo: input.rest?.to ?? null,
          issuedBy: actor.userId,
        })
        .returning();
      const certificate = found(inserted, "Medical certificate");
      await this.audit.record(tx, actor, {
        action: "encounter.certificate.issue",
        resourceType: "medical_certificate",
        resourceId: certificate.id,
        patientId: certificate.patientId,
        metadata: { encounterId, certificateNumber: certificate.certificateNumber, restDays: restDays(certificate.restFrom, certificate.restTo) },
      });
      await this.events.record(tx, {
        type: "MedicalCertificateIssued",
        organizationId: actor.organizationId,
        aggregateType: "medical_certificate",
        aggregateId: certificate.id,
        facilityId: certificate.facilityId,
        patientId: certificate.patientId,
        payload: { encounterId, certificateNumber: certificate.certificateNumber },
      });
      return certificate;
    });
    await this.ensureDocument(created);
    return (await this.views(actor.organizationId, [created]))[0]!;
  }

  async listForEncounter(actor: Actor, encounterId: string): Promise<MedicalCertificateView[]> {
    const rows = await this.db
      .select()
      .from(medicalCertificate)
      .where(and(eq(medicalCertificate.organizationId, actor.organizationId), eq(medicalCertificate.encounterId, encounterId)))
      .orderBy(desc(medicalCertificate.issuedAt));
    return this.views(actor.organizationId, rows);
  }

  /** A patient's issued (not voided) certificates, newest first — what MyHealth lists. */
  async issuedForPatient(organizationId: string, patientId: string): Promise<MedicalCertificateView[]> {
    const rows = await this.db
      .select()
      .from(medicalCertificate)
      .where(
        and(
          eq(medicalCertificate.organizationId, organizationId),
          filedAsPatient(medicalCertificate.patientId, patientId),
          eq(medicalCertificate.status, "issued"),
        ),
      )
      .orderBy(desc(medicalCertificate.issuedAt));
    return this.views(organizationId, rows);
  }

  async get(actor: Actor, certificateId: string): Promise<MedicalCertificateView> {
    return (await this.views(actor.organizationId, [await this.find(actor.organizationId, certificateId)]))[0]!;
  }

  /** Voids a mistaken certificate (the issuing practitioner, or staff who may amend consultations); its document is archived. */
  async void(actor: Actor, certificateId: string, reason: string): Promise<MedicalCertificateView> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const voided = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(medicalCertificate)
        .where(and(eq(medicalCertificate.organizationId, actor.organizationId), eq(medicalCertificate.id, certificateId)))
        .for("update");
      const current = found(row, "Medical certificate");
      if (current.status === "void") throw new BusinessRuleError("The certificate is already void", "certificate_void");
      if (clinician?.id !== current.practitionerId && !actor.permissions.has("encounter.amend")) {
        throw new ForbiddenError("Only the issuing practitioner, or staff who may amend consultations, void a certificate");
      }
      const [updated] = await tx
        .update(medicalCertificate)
        .set({ status: "void", voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason })
        .where(eq(medicalCertificate.id, certificateId))
        .returning();
      const certificate = found(updated, "Medical certificate");
      await this.audit.record(tx, actor, {
        action: "encounter.certificate.void",
        resourceType: "medical_certificate",
        resourceId: certificateId,
        patientId: certificate.patientId,
        reason,
        metadata: { certificateNumber: certificate.certificateNumber },
      });
      await this.events.record(tx, {
        type: "MedicalCertificateVoided",
        organizationId: actor.organizationId,
        aggregateType: "medical_certificate",
        aggregateId: certificateId,
        facilityId: certificate.facilityId,
        patientId: certificate.patientId,
        payload: { encounterId: certificate.encounterId },
      });
      return certificate;
    });
    // The stored copy leaves circulation (a copy printed before stays in the patient's hands: the number is void).
    await this.documents.archive(actor, voided.id, `Medical certificate ${voided.certificateNumber} voided: ${reason}`).catch(() => undefined);
    return (await this.views(actor.organizationId, [voided]))[0]!;
  }

  /** The printable copy: the stored document, or — for a voided certificate — a fresh copy marked VOID (not stored). */
  async pdf(actor: Actor, certificateId: string): Promise<{ filename: string; pdf: Buffer }> {
    const certificate = await this.find(actor.organizationId, certificateId);
    const filename = `medical-certificate-${certificate.certificateNumber}.pdf`;
    if (certificate.status === "void") {
      await this.audit.recordStandalone(actor, {
        action: "encounter.certificate.print",
        resourceType: "medical_certificate",
        resourceId: certificate.id,
        patientId: certificate.patientId,
        metadata: { void: true },
      });
      return { filename, pdf: await this.render(certificate) };
    }
    await this.ensureDocument(certificate);
    const { body } = await this.documents.content(actor, certificate.id);
    return { filename, pdf: body };
  }

  /** A short-lived link for the patient in MyHealth (an issued certificate of theirs); audited as their access. */
  async patientLink(context: PatientAuditContext, certificateId: string) {
    const [row] = await this.db
      .select()
      .from(medicalCertificate)
      .where(
        and(
          eq(medicalCertificate.organizationId, context.organizationId),
          eq(medicalCertificate.id, certificateId),
          filedAsPatient(medicalCertificate.patientId, context.patientId),
          eq(medicalCertificate.status, "issued"),
        ),
      );
    if (!row) throw new NotFoundError("Medical certificate");
    await this.ensureDocument(row);
    return this.documents.downloadUrlForPatient(context, row.id);
  }

  // ---- internals ------------------------------------------------------------------------------

  /** Stores the printable copy once (idempotent: the document's id is the certificate's). */
  private async ensureDocument(certificate: MedicalCertificateRecord): Promise<void> {
    const actor = systemActor(certificate.organizationId, certificate.facilityId, "medical-certificate");
    await this.documents.storeGenerated(actor, {
      id: certificate.id,
      facilityId: certificate.facilityId,
      patientId: certificate.patientId,
      category: "medical_certificate",
      title: `Medical certificate ${certificate.certificateNumber}`,
      fileName: `medical-certificate-${certificate.certificateNumber}.pdf`,
      contentType: "application/pdf",
      body: await this.render(certificate),
    });
  }

  private async render(certificate: MedicalCertificateRecord): Promise<Buffer> {
    const [organization, facility, patients, [clinician], [consultation]] = await Promise.all([
      this.organizations.getOrganization(certificate.organizationId),
      this.organizations.getFacility(certificate.organizationId, certificate.facilityId),
      this.patients.summaries(certificate.organizationId, [certificate.patientId]),
      this.db.select().from(practitioner).where(eq(practitioner.id, certificate.practitionerId)),
      this.db.select({ modality: encounter.modality }).from(encounter).where(eq(encounter.id, certificate.encounterId)),
    ]);
    const patient = patients.get(certificate.patientId);
    const days = restDays(certificate.restFrom, certificate.restTo);
    const online = consultation?.modality === "telemedicine";
    return renderPdf(
      {
        title: "Medical Certificate",
        letterhead: facilityLetterhead(organization.name, facility),
        // The date it was issued (the stored copy is the same however often it is printed).
        printedAt: `Issued ${pdfDateTime(certificate.issuedAt, facility.timezone)}`,
        watermark: certificate.status === "void" ? "VOID" : undefined,
        footerNote: `Certificate ${certificate.certificateNumber}. The facility can confirm that this certificate was issued and is not void.`,
      },
      (w) => {
        w.fields([
          ["Certificate number", certificate.certificateNumber],
          ["Date issued", pdfDate(certificate.issuedAt, facility.timezone)],
          ["Patient", patient?.displayName ?? "Patient"],
          ["Patient number", patient?.patientNumber ?? null],
          ["Age / sex", patient ? `${patient.age} / ${patient.sex}` : null],
          [online ? "Consulted online on" : "Examined on", pdfDate(certificate.examinedOn)],
        ]);
        w.space();
        w.paragraph(
          `This is to certify that ${patient?.displayName ?? "the patient"} was ${online ? "seen in an online consultation" : "examined"} at ${facility.name} on ${pdfDate(certificate.examinedOn)}.`,
        );
        w.space();
        w.heading("Purpose");
        w.paragraph(certificate.purpose);
        w.heading("Findings / diagnosis");
        w.paragraph(certificate.findings);
        if (certificate.recommendations) {
          w.heading("Recommendations");
          w.paragraph(certificate.recommendations);
        }
        if (certificate.restFrom && certificate.restTo && days) {
          w.heading("Rest");
          w.paragraph(
            `${days} day${days === 1 ? "" : "s"}, from ${pdfDate(certificate.restFrom)} to ${pdfDate(certificate.restTo)}${online ? ", as assessed in the online consultation" : ""}.`,
          );
        }
        w.space();
        w.signatures([
          {
            name: clinician?.displayName ?? " ",
            role: clinician?.licenseNumber ? `License no. ${clinician.licenseNumber}` : "Attending practitioner",
          },
        ]);
      },
    );
  }

  private async find(organizationId: string, certificateId: string): Promise<MedicalCertificateRecord> {
    const [row] = await this.db
      .select()
      .from(medicalCertificate)
      .where(and(eq(medicalCertificate.organizationId, organizationId), eq(medicalCertificate.id, certificateId)));
    return found(row, "Medical certificate");
  }

  private async views(organizationId: string, rows: MedicalCertificateRecord[]): Promise<MedicalCertificateView[]> {
    if (!rows.length) return [];
    const clinicians = await this.db
      .select({ id: practitioner.id, displayName: practitioner.displayName })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), inArray(practitioner.id, [...new Set(rows.map((r) => r.practitionerId))])));
    const names = new Map(clinicians.map((c) => [c.id, c.displayName]));
    return rows.map((r) => ({ ...publicView(r), practitionerName: names.get(r.practitionerId) ?? null, restDays: restDays(r.restFrom, r.restTo) }));
  }
}
