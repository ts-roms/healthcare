import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, type StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequirePermissions } from "@healthcare/core";
import { AnswerReferralDto, CancelReferralDto, CompleteReferralDto, CreateReferralDto, LinkReferralAppointmentDto, ReferralQueryDto } from "../clinic.dto";
import { ReferralService } from "./referral.service";

@ApiTags("referrals")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Get("encounters/:encounterId/referrals")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Referrals made from this consultation (cancelled ones included)" })
  forEncounter(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string) {
    return this.referrals.listForEncounter(actor, id);
  }

  @Post("encounters/:encounterId/referrals")
  @RequirePermissions("encounter.write")
  @ApiOperation({ summary: "Refer the patient from this consultation (its responsible practitioner): to a practitioner here, or to an outside provider" })
  create(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) id: string, @Body() body: CreateReferralDto) {
    return this.referrals.create(actor, id, body);
  }

  @Get("referrals")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Referrals to me, from me, open (oldest first) or all recent; optionally for one patient" })
  list(@CurrentActor() actor: Actor, @Query() query: ReferralQueryDto) {
    return this.referrals.list(actor, query);
  }

  @Get("referrals/:referralId")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "One referral (audited)" })
  get(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string) {
    return this.referrals.get(actor, id);
  }

  @Get("referrals/:referralId/letter.pdf")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "The referral letter (audited); a cancelled one is marked CANCELLED" })
  async letter(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.referrals.letter(actor, id);
    return pdfFile(pdf, filename);
  }

  @Post("referrals/:referralId/answer")
  @HttpCode(200)
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Accept, or decline with a reason (the practitioner referred to)" })
  answer(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string, @Body() body: AnswerReferralDto) {
    return this.referrals.answer(actor, id, body);
  }

  @Post("referrals/:referralId/appointment")
  @HttpCode(200)
  @RequirePermissions("appointment.manage")
  @ApiOperation({ summary: "Link the appointment booked for an internal referral (this patient, the practitioner referred to)" })
  linkAppointment(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string, @Body() body: LinkReferralAppointmentDto) {
    return this.referrals.linkAppointment(actor, id, body);
  }

  @Post("referrals/:referralId/complete")
  @HttpCode(200)
  @RequirePermissions("encounter.write")
  @ApiOperation({ summary: "Complete: the practitioner referred to (internal), or record the outside provider's reply (external)" })
  complete(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string, @Body() body: CompleteReferralDto) {
    return this.referrals.complete(actor, id, body);
  }

  @Post("referrals/:referralId/cancel")
  @HttpCode(200)
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Cancel an open referral with a reason (the referrer, or staff with encounter.amend)" })
  cancel(@CurrentActor() actor: Actor, @Param("referralId", ParseUUIDPipe) id: string, @Body() body: CancelReferralDto) {
    return this.referrals.cancel(actor, id, body);
  }
}
