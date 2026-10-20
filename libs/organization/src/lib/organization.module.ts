import { Module } from "@nestjs/common";
import { ComplianceController } from "./compliance/compliance.controller";
import { ComplianceReviewService } from "./compliance/compliance-review.service";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";
import { PrivacyController } from "./privacy/privacy.controller";
import { PrivacyIncidentService } from "./privacy/privacy-incident.service";

@Module({
  controllers: [OrganizationController, ComplianceController, PrivacyController],
  providers: [OrganizationService, ComplianceReviewService, PrivacyIncidentService],
  exports: [OrganizationService, ComplianceReviewService, PrivacyIncidentService],
})
export class OrganizationModule {}
