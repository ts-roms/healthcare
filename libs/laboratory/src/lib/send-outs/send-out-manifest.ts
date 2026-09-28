import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, NotFoundError, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, type Letterhead, pdfDateTime, renderPdf } from "@healthcare/pdf";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { SendOutService } from "./send-out.service";

const SEX_CODE: Record<string, string> = { male: "M", female: "F" };

export interface ManifestData {
  letterhead: Letterhead;
  timeZone: string;
  manifestNumber: string;
  referenceLaboratory: { name: string; accreditationReference: string | null };
  courier: string;
  courierReference: string | null;
  dispatchedAt: Date;
  dispatchedBy: string | null;
  rows: Array<{
    accessionNumber: string;
    patient: string;
    patientNumber: string;
    sexAge: string;
    specimen: string;
    collectedAt: Date;
    tests: string;
    stat: boolean;
  }>;
}

/**
 * The send-out manifest (PDF): what travels in one dispatch to a reference laboratory. Minimal identification, as on
 * the tube labels: accession number, patient name and number, sex/age, specimen, collection time and test codes — no
 * birth date, address, indication or results. Signature lines for the handover. Cancelled send-outs are not listed.
 */
@Injectable()
export class SendOutManifestService {
  constructor(
    private readonly sendOuts: SendOutService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
  ) {}

  async manifest(actor: Actor, dispatchId: string): Promise<{ filename: string; pdf: Buffer }> {
    const facilityId = requireFacilityId(actor);
    const source = await this.sendOuts.dispatchSource(actor.organizationId, dispatchId);
    if (!source) throw new NotFoundError("Dispatch");
    if (source.dispatch.facilityId !== facilityId) throw new BusinessRuleError("This dispatch belongs to another facility", "wrong_facility");
    const specimens = source.specimens.map((s) => ({ ...s, tests: s.tests.filter((t) => t.status !== "cancelled") })).filter((s) => s.tests.length > 0);
    const [organization, facility, patients, staff] = await Promise.all([
      this.organizations.getOrganization(actor.organizationId),
      this.organizations.getFacility(actor.organizationId, source.dispatch.facilityId),
      this.context.patientBriefs(actor.organizationId, [...new Set(specimens.map((s) => s.patientId))]),
      this.context.staffNames(actor.organizationId, [source.dispatch.dispatchedBy]),
    ]);
    const data: ManifestData = {
      letterhead: facilityLetterhead(organization.name, facility),
      timeZone: facility.timezone,
      manifestNumber: source.dispatch.manifestNumber,
      referenceLaboratory: { name: source.referenceLaboratory.name, accreditationReference: source.referenceLaboratory.accreditationReference },
      courier: source.dispatch.courier,
      courierReference: source.dispatch.courierReference,
      dispatchedAt: source.dispatch.dispatchedAt,
      dispatchedBy: staff.get(source.dispatch.dispatchedBy) ?? null,
      rows: specimens.map((s) => {
        const p = patients.get(s.patientId);
        return {
          accessionNumber: s.accessionNumber,
          patient: p?.displayName ?? "Patient",
          patientNumber: p?.patientNumber ?? "",
          sexAge: p ? `${SEX_CODE[p.sex] ?? p.sex} / ${p.age} y` : "",
          specimen: s.container ? `${s.specimenType} (${s.container})` : s.specimenType,
          collectedAt: s.collectedAt,
          tests: s.tests.map((t) => t.code.toUpperCase()).join(", "),
          stat: s.priority === "stat",
        };
      }),
    };
    const pdf = await renderSendOutManifest(data);
    for (const patientId of new Set(specimens.map((s) => s.patientId))) {
      await this.audit.recordStandalone(actor, {
        action: "lab.send-out.manifest-print",
        resourceType: "lab_send_out_dispatch",
        resourceId: dispatchId,
        patientId,
        metadata: { manifestNumber: source.dispatch.manifestNumber },
      });
    }
    return { filename: `manifest-${source.dispatch.manifestNumber}.pdf`, pdf };
  }
}

export function renderSendOutManifest(data: ManifestData): Promise<Buffer> {
  const tz = data.timeZone;
  return renderPdf(
    {
      title: "Send-out Manifest",
      subtitle: `Specimens referred to ${data.referenceLaboratory.name}`,
      letterhead: data.letterhead,
      printedAt: `Printed ${pdfDateTime(new Date(), tz)}`,
      footerNote: "Specimen handover record. Contains patient identifiers: handle as confidential and keep with the specimens.",
    },
    (w) => {
      w.fields(
        [
          ["Manifest number", data.manifestNumber],
          ["Reference laboratory", data.referenceLaboratory.name],
          ["Accreditation / licence (as recorded)", data.referenceLaboratory.accreditationReference],
          ["Courier", data.courier],
          ["Courier reference", data.courierReference],
          ["Dispatched", pdfDateTime(data.dispatchedAt, tz)],
          ["Dispatched by", data.dispatchedBy],
          ["Specimens", String(data.rows.length)],
        ],
        2,
      );
      w.space();
      w.table(
        [
          { header: "Accession", width: 1.6 },
          { header: "Patient", width: 2.4 },
          { header: "Sex / age", width: 0.9 },
          { header: "Specimen", width: 1.8 },
          { header: "Collected", width: 1.6 },
          { header: "Tests", width: 2 },
        ],
        data.rows.map((r) => [
          r.accessionNumber,
          `${r.patient}${r.patientNumber ? ` (${r.patientNumber})` : ""}`,
          r.sexAge,
          r.specimen,
          pdfDateTime(r.collectedAt, tz),
          r.stat ? `STAT  ${r.tests}` : r.tests,
        ]),
        { emphasis: data.rows.flatMap((r, i) => (r.stat ? [i] : [])) },
      );
      w.paragraph("Check each tube against this list at handover. Record any discrepancy on the reference laboratory's own receiving form.", {
        muted: true,
      });
      w.signatures([
        { name: data.dispatchedBy ?? "", role: "Released by (laboratory)" },
        { name: "", role: "Courier" },
        { name: "", role: "Received by (reference laboratory)" },
      ]);
    },
  );
}
