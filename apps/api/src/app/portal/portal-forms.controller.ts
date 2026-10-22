import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { ConsentSignatureService, PortalSignFormDto } from "@healthcare/clinic";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, PortalAccountService, ProxyAllowed, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * Consent forms the clinic asked the patient to sign (docs/architecture/electronic-signatures.md, phase 2). The patient — or a
 * guardian acting for them (`@ProxyAllowed()`, the "act" scope for signing) — reads the wording of the version fixed on the
 * request and signs by drawing. Signing needs the password again (a wrong one counts toward the sign-in lockout), and a minor's
 * form is signed by a parent or guardian only. Listed only when the organization signs in MyHealth.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@ProxyAllowed()
@Controller({ path: "portal/forms", version: "1" })
export class PortalFormsController {
  constructor(
    private readonly signatures: ConsentSignatureService,
    private readonly accounts: PortalAccountService,
    private readonly audit: AuditService,
  ) {}

  /** For the navigation: how many forms wait (like the unread-message count, not audited). */
  @Get("count")
  @ApiOperation({ summary: "How many consent forms await the patient's signature" })
  async count(@CurrentPatient() patient: PortalPrincipal) {
    return { count: (await this.signatures.portalList(patient.organizationId, patient.patientId)).length };
  }

  @Get()
  @ApiOperation({ summary: "Consent forms awaiting the patient's signature, with the wording to read" })
  async list(@CurrentPatient() patient: PortalPrincipal) {
    const forms = await this.signatures.portalList(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.consent-forms-view",
      resourceType: "patient",
      resourceId: patient.patientId,
      patientId: patient.patientId,
      metadata: { count: forms.length },
    });
    return forms;
  }

  @Post(":requestId/sign")
  @ApiOperation({ summary: "Sign a requested consent form by drawing, after confirming the password again" })
  async sign(@CurrentPatient() patient: PortalPrincipal, @Param("requestId", ParseUUIDPipe) requestId: string, @Body() body: PortalSignFormDto) {
    await this.accounts.confirmPassword(patient, body.password);
    return this.signatures.portalSign(
      {
        audit: patientAuditContext(patient),
        patientId: patient.patientId,
        accountId: patient.accountId,
        proxyGrantId: patient.proxy?.grantId ?? null,
        signerPatientId: patient.proxy?.guardianPatientId ?? patient.patientId,
        relationship: patient.proxy?.relationship ?? null,
        device: patient.request.userAgent ? patient.request.userAgent.slice(0, 300) : null,
      },
      requestId,
      body.strokes,
    );
  }
}
