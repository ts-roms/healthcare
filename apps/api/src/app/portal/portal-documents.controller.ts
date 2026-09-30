import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { MedicalCertificateService, ReferralService } from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import {
  CurrentPatient,
  PatientAccessGuard,
  ProxyAllowed,
  patientAuditContext,
  type PortalPrincipal,
  RecordsRequestService,
  SubmitRecordsRequestDto,
} from "@healthcare/patient";

/**
 * The patient's documents in MyHealth: medical certificates issued to them (not voided), referrals made for them (to
 * whom, when, urgency and status — the letter holds the rest) and their records requests with the documents shared in
 * answer. Files open through short-lived links, each audited as the patient's access;
 * reading the lists is audited once per request (`portal.documents-view`). The patient guard re-checks the session,
 * account and portal consent on every request.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal", version: "1" })
export class PortalDocumentsController {
  constructor(
    private readonly certificates: MedicalCertificateService,
    private readonly referrals: ReferralService,
    private readonly requests: RecordsRequestService,
    private readonly audit: AuditService,
  ) {}

  @Get("documents")
  @ApiOperation({ summary: "The patient's medical certificates and records requests (with the documents shared in answer)" })
  async documents(@CurrentPatient() patient: PortalPrincipal) {
    const [certificates, referrals, requests, procedure] = await Promise.all([
      this.certificates.issuedForPatient(patient.organizationId, patient.patientId),
      this.referrals.issuedForPatient(patient.organizationId, patient.patientId),
      this.requests.forPatient(patient.organizationId, patient.patientId),
      this.requests.setting(patient.organizationId),
    ]);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.documents-view",
      resourceType: "patient",
      resourceId: patient.patientId,
      patientId: patient.patientId,
      metadata: { certificates: certificates.length, referrals: referrals.length, requests: requests.length },
    });
    return {
      // What the certificate is, when and from whom — its contents are in the PDF.
      certificates: certificates.map((c) => ({
        id: c.id,
        certificateNumber: c.certificateNumber,
        examinedOn: c.examinedOn,
        issuedAt: c.issuedAt,
        purpose: c.purpose,
        practitionerName: c.practitionerName,
        restDays: c.restDays,
      })),
      // To whom, when, urgency and status; the reason and summary are in the letter.
      referrals,
      requests,
      /** What the organization tells patients before they ask (its own words), and its response time in days. */
      requestNotice: procedure.patientNotice,
      responseDays: procedure.responseDays,
    };
  }

  @Get("certificates/:certificateId/link")
  @ApiOperation({ summary: "A short-lived link to one of the patient's medical certificates (audited)" })
  certificateLink(@CurrentPatient() patient: PortalPrincipal, @Param("certificateId", ParseUUIDPipe) id: string) {
    return this.certificates.patientLink(patientAuditContext(patient), id);
  }

  @Get("referrals/:referralId/link")
  @ApiOperation({ summary: "A short-lived link to the letter of one of the patient's referrals (not a cancelled one; audited)" })
  referralLink(@CurrentPatient() patient: PortalPrincipal, @Param("referralId", ParseUUIDPipe) id: string) {
    return this.referrals.patientLink(patientAuditContext(patient), id);
  }

  @Post("records-requests")
  @ApiOperation({ summary: "Ask the records office for copies of records (at most 3 open at once)" })
  submit(@CurrentPatient() patient: PortalPrincipal, @Body() body: SubmitRecordsRequestDto) {
    return this.requests.submit(patientAuditContext(patient), body);
  }

  @Post("records-requests/:requestId/withdraw")
  @HttpCode(200)
  @ApiOperation({ summary: "Withdraw an open request" })
  withdraw(@CurrentPatient() patient: PortalPrincipal, @Param("requestId", ParseUUIDPipe) id: string) {
    return this.requests.withdraw(patientAuditContext(patient), id);
  }

  @Get("records-requests/documents/:documentId/link")
  @ApiOperation({ summary: "A short-lived link to a document shared in answer to one of the patient's requests (audited)" })
  sharedDocumentLink(@CurrentPatient() patient: PortalPrincipal, @Param("documentId", ParseUUIDPipe) id: string) {
    return this.requests.patientDocumentLink(patientAuditContext(patient), id);
  }
}
