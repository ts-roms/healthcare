import { Global, Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { AuditAssistantQueries } from "./assistant/audit-assistant.queries";
import { AuditService } from "./audit.service";

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditAssistantQueries],
  exports: [AuditService, AuditAssistantQueries],
})
export class AuditModule {}
