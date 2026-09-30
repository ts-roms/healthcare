import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { AppointmentReminders } from "./appointments/appointment-reminders";
import { AppointmentService } from "./appointments/appointment.service";
import { NoShowFollowUp } from "./appointments/no-show-follow-up";
import { PatientBookingNotices } from "./appointments/patient-booking-notices";
import { PatientBookingService } from "./appointments/patient-booking.service";
import {
  AppointmentController,
  ClinicalRecordsController,
  ClinicConfigController,
  ClinicDashboardController,
  EncounterController,
  QueueController,
} from "./clinic.controllers";
import { MedicalCertificateController } from "./certificates/medical-certificate.controller";
import { MedicalCertificateService } from "./certificates/medical-certificate.service";
import { ReferralController } from "./referrals/referral.controller";
import { ReferralService } from "./referrals/referral.service";
import { ClinicQueries } from "./clinic-queries.service";
import { ClinicReportingQueries } from "./dashboard/clinic-reporting.queries";
import { ClinicConfigService } from "./config/clinic-config.service";
import { ClinicDashboardService } from "./dashboard/clinic-dashboard.service";
import { EncounterService } from "./encounters/encounter.service";
import { ExternalHistoryController } from "./external/external-history.controller";
import { ExternalRecordsService } from "./external/external-records.service";
import { OnlineVisitService } from "./online/online-visit.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "./ports";
import { VisitService } from "./queue/visit.service";
import { TriageService } from "./triage/triage.service";

export interface ClinicModuleOptions {
  /** Modules providing what the patient directory adapter depends on. */
  imports?: ModuleMetadata["imports"];
  patientDirectory: Type<PatientDirectory>;
}

/** Clinic / EMR: scheduling, queue, triage, encounters, diagnoses, clinic dashboard. */
@Module({})
export class ClinicModule {
  static forRoot(options: ClinicModuleOptions): DynamicModule {
    return {
      module: ClinicModule,
      global: true,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [
        ClinicConfigController,
        AppointmentController,
        QueueController,
        ClinicalRecordsController,
        EncounterController,
        ClinicDashboardController,
        ExternalHistoryController,
        MedicalCertificateController,
        ReferralController,
      ],
      providers: [
        AppointmentReminders,
        AppointmentService,
        ClinicConfigService,
        ClinicDashboardService,
        ClinicQueries,
        ClinicReportingQueries,
        EncounterService,
        ExternalRecordsService,
        MedicalCertificateService,
        ReferralService,
        NoShowFollowUp,
        OnlineVisitService,
        PatientBookingNotices,
        PatientBookingService,
        TriageService,
        VisitService,
        { provide: PATIENT_DIRECTORY, useClass: options.patientDirectory },
      ],
      exports: [
        ClinicQueries,
        ClinicReportingQueries,
        ExternalRecordsService,
        MedicalCertificateService,
        ReferralService,
        OnlineVisitService,
        PatientBookingService,
      ],
    };
  }
}
