import { Module } from "@nestjs/common";
import { ComplianceController } from "./compliance/compliance.controller";
import { ComplianceReviewService } from "./compliance/compliance-review.service";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";

@Module({
  controllers: [OrganizationController, ComplianceController],
  providers: [OrganizationService, ComplianceReviewService],
  exports: [OrganizationService, ComplianceReviewService],
})
export class OrganizationModule {}
