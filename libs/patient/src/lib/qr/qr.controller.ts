import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, type StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequirePermissions } from "@healthcare/core";
import { PatientQrSettingDto, RevokePatientQrDto, ScanPatientQrDto } from "./qr.dto";
import { PatientQrService } from "./qr.service";

/** Patient QR codes. Routes live under `patient-qr` so they never collide with `patients/:patientId`. */
@ApiTags("patient-qr")
@ApiBearerAuth()
@Controller({ path: "patient-qr", version: "1" })
export class PatientQrController {
  constructor(private readonly qr: PatientQrService) {}

  @Get("setting")
  @RequirePermissions("patient.search")
  @ApiOperation({ summary: "Whether patient QR codes are on and what they encode (the staff registration form reads this)" })
  setting(@CurrentActor() actor: Actor) {
    return this.qr.setting(actor.organizationId);
  }

  @Put("setting")
  @RequirePermissions("patient.qr.manage")
  @ApiOperation({ summary: "Turn patient QR codes on or off, issue at registration, and choose what they encode (audited)" })
  setSetting(@CurrentActor() actor: Actor, @Body() body: PatientQrSettingDto) {
    return this.qr.setSetting(actor, body);
  }

  @Post("scan")
  @HttpCode(200)
  @RequirePermissions("patient.search")
  @ApiOperation({ summary: "Resolve a scanned QR code to a patient summary (audited; the payload is never stored)" })
  scan(@CurrentActor() actor: Actor, @Body() body: ScanPatientQrDto) {
    return this.qr.scan(actor, body.payload);
  }

  @Get("patients/:patientId")
  @RequirePermissions("patient.qr.issue", "patient.read")
  @ApiOperation({ summary: "A patient's active QR code (with what it encodes, for drawing it) and revoked ones (audited)" })
  state(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.qr.state(actor, patientId);
  }

  @Post("patients/:patientId")
  @RequirePermissions("patient.qr.issue", "patient.read")
  @ApiOperation({ summary: "Issue a QR code for a patient who has none active" })
  issue(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.qr.issue(actor, patientId);
  }

  @Post("patients/:patientId/revoke")
  @HttpCode(200)
  @RequirePermissions("patient.qr.issue", "patient.read")
  @ApiOperation({ summary: "Revoke the active QR code (a lost card), with a reason" })
  revoke(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RevokePatientQrDto) {
    return this.qr.revoke(actor, patientId, body.reason);
  }

  @Get("patients/:patientId/card.pdf")
  @RequirePermissions("patient.qr.issue", "patient.read")
  @ApiOperation({ summary: "The patient card (QR code, name, patient number) as a PDF (audited)" })
  async card(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string): Promise<StreamableFile> {
    return pdfFile(await this.qr.cardPdf(actor, patientId), "patient-card.pdf");
  }
}
