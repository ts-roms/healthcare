import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Actor, CurrentActor, pageQuerySchema, RequirePermissions } from '@healthcare/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from './audit.service';

const auditQuerySchema = pageQuerySchema.extend({
  patientId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  resourceType: z.string().max(64).optional(),
  resourceId: z.string().max(128).optional(),
  action: z.string().max(128).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
class AuditQueryDto extends createZodDto(auditQuerySchema) {}

@ApiTags('audit')
@Controller({ path: 'audit-events', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Search the audit trail of the current organization' })
  async list(@CurrentActor() actor: Actor, @Query() query: AuditQueryDto) {
    const page = await this.audit.list(actor.organizationId, query);
    // Reading the audit trail is itself a sensitive action.
    const { page: _page, pageSize: _pageSize, ...filters } = query;
    await this.audit.recordStandalone(actor, {
      action: 'audit.search',
      resourceType: 'audit_event',
      patientId: query.patientId,
      metadata: { filters },
    });
    return page;
  }
}
