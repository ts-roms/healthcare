import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, type StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequirePermissions } from "@healthcare/core";
import { IssueCertificateDto, VoidCertificateDto } from "../clinic.dto";
import { MedicalCertificateService } from "./medical-certificate.service";

@ApiTags("medical certificates")
@ApiBearerAuth()
@Controller({ version: "1" })
export class MedicalCertificateController {
  constructor(private readonly certificates: MedicalCertificateService) {}

  @Get("encounters/:encounterId/certificates")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Medical certificates issued from this consultation (voided ones included)" })
  list(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string) {
    return this.certificates.listForEncounter(actor, id);
  }

  @Post("encounters/:encounterId/certificates")
  @RequirePermissions("encounter.sign")
  @ApiOperation({ summary: "Issue a medical certificate from a signed consultation (its responsible practitioner)" })
  issue(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: IssueCertificateDto) {
    return this.certificates.issue(actor, id, body);
  }

  @Get("medical-certificates/:certificateId")
  @RequirePermissions("encounter.read")
  get(@CurrentActor() actor: Actor, @Param("certificateId", ParseUUIDPipe) id: string) {
    return this.certificates.get(actor, id);
  }

  @Get("medical-certificates/:certificateId/certificate.pdf")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "The printable certificate (audited); a voided one is marked VOID" })
  async pdf(@CurrentActor() actor: Actor, @Param("certificateId", ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.certificates.pdf(actor, id);
    return pdfFile(pdf, filename);
  }

  @Post("medical-certificates/:certificateId/void")
  @HttpCode(200)
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Void a mistaken certificate with a reason (the issuing practitioner, or staff with encounter.amend)" })
  void(@CurrentActor() actor: Actor, @Param("certificateId", ParseUUIDPipe) id: string, @Body() body: VoidCertificateDto) {
    return this.certificates.void(actor, id, body.reason);
  }
}
