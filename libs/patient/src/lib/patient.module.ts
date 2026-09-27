import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PatientController } from "./patient.controller";
import { PatientRecordService } from "./patient-record.service";
import { PatientRegistrationService } from "./patient-registration.service";
import { PatientSearchService } from "./patient-search.service";
import { PatientAccessGuard } from "./portal/patient-access.guard";
import { PatientPortalAccountController, PortalController } from "./portal/portal.controller";
import { PortalAccountService } from "./portal/portal-account.service";
import { PortalTokenService } from "./portal/portal-tokens";

@Module({
  imports: [JwtModule.register({})],
  controllers: [PatientController, PortalController, PatientPortalAccountController],
  providers: [PatientRecordService, PatientRegistrationService, PatientSearchService, PortalAccountService, PortalTokenService, PatientAccessGuard],
  exports: [PatientRecordService],
})
export class PatientModule {}
