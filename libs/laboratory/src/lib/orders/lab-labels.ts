import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { type LabelSpec, pdfDateTime, renderLabels, SPECIMEN_LABEL_STOCK } from "@healthcare/pdf";
import { and, asc, eq, ne } from "drizzle-orm";
import { labOrder, labOrderItem, labSpecimen, labSpecimenType } from "../laboratory.schema";
import { found } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";

const SEX_CODE: Record<string, string> = { male: "M", female: "F" };

/**
 * Specimen tube labels (PDF, one label per page on 2.25 × 1.25 in stock): a
 * Code 128 barcode of the accession number — what the workbench scanner reads
 * — and only what identifies the specimen at the bench: patient name and
 * number, sex/age, specimen type, collection time (facility time zone) and
 * test codes. No birth date, address, indication or results.
 */
@Injectable()
export class LabLabelService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async specimenLabels(actor: Actor, specimenId: string, copies: number): Promise<{ filename: string; pdf: Buffer }> {
    const facilityId = requireFacilityId(actor);
    const [row] = await this.db
      .select({ specimen: labSpecimen, specimenTypeName: labSpecimenType.name, priority: labOrder.priority })
      .from(labSpecimen)
      .innerJoin(labSpecimenType, eq(labSpecimenType.id, labSpecimen.specimenTypeId))
      .innerJoin(labOrder, eq(labOrder.id, labSpecimen.orderId))
      .where(and(eq(labSpecimen.organizationId, actor.organizationId), eq(labSpecimen.id, specimenId)));
    const { specimen, specimenTypeName, priority } = found(row, "Specimen");
    if (specimen.facilityId !== facilityId) throw new BusinessRuleError("This specimen belongs to another facility", "wrong_facility");
    if (specimen.status === "rejected") throw new BusinessRuleError("A rejected specimen is not labelled; collect a new one", "specimen_rejected");
    const [facility, briefs, items] = await Promise.all([
      this.organizations.getFacility(actor.organizationId, specimen.facilityId),
      this.context.patientBriefs(actor.organizationId, [specimen.patientId]),
      this.db
        .select({ testCode: labOrderItem.testCode })
        .from(labOrderItem)
        .where(and(eq(labOrderItem.specimenId, specimenId), ne(labOrderItem.status, "cancelled")))
        .orderBy(asc(labOrderItem.testCode)),
    ]);
    const patient = briefs.get(specimen.patientId);
    const label: LabelSpec = {
      top: [
        { text: patient?.displayName ?? "Patient", bold: true, size: 7.5 },
        {
          text: [patient?.patientNumber, patient ? `${SEX_CODE[patient.sex] ?? patient.sex} / ${patient.age} y` : null].filter(Boolean).join("  ·  "),
        },
      ],
      barcode: specimen.accessionNumber,
      bottom: [
        { text: [priority === "stat" ? "STAT" : null, specimenTypeName, pdfDateTime(specimen.collectedAt, facility.timezone)].filter(Boolean).join("  ·  ") },
        { text: items.map((i) => i.testCode.toUpperCase()).join(", "), maxLines: 2, size: 6 },
      ],
    };
    const pdf = await renderLabels(
      SPECIMEN_LABEL_STOCK,
      Array.from({ length: copies }, () => label),
      { title: `Specimen ${specimen.accessionNumber}` },
    );
    await this.audit.recordStandalone(actor, {
      action: "lab.specimen.label-print",
      resourceType: "lab_specimen",
      resourceId: specimenId,
      patientId: specimen.patientId,
      metadata: { accessionNumber: specimen.accessionNumber, copies },
    });
    return { filename: `label-${specimen.accessionNumber}.pdf`, pdf };
  }
}
