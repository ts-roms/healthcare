import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, NotFoundError, RequirePlatformAdmin } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { AuditRetentionService } from "./audit-retention.service";

/** A partition name as the database names them (audit_event_history, audit_event_YYYY_MM); anything else is not found. */
function partitionName(name: string): string {
  if (!/^audit_event_(history|\d{4}_\d{2})$/.test(name)) throw new NotFoundError("Audit partition");
  return name;
}
class RemoveDto extends createZodDto(z.object({ reason: z.string().trim().min(5).max(500) })) {}

/**
 * Audit trail retention (docs/runbooks/audit-retention.md): platform administrators only, because a month's partition
 * holds every organization's events.
 */
@ApiTags("administration")
@ApiBearerAuth()
@Controller({ path: "audit/retention", version: "1" })
export class AuditRetentionController {
  constructor(private readonly retention: AuditRetentionService) {}

  @Get("partitions")
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "The audit trail's monthly partitions, their archives, and which may be archived or removed" })
  partitions() {
    return this.retention.partitions();
  }

  @Post("partitions/:name/archive")
  @HttpCode(202)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Archive a closed month to object storage (written and verified in the background)" })
  archive(@CurrentActor() actor: Actor, @Param("name") name: string) {
    return this.retention.requestArchive(actor, partitionName(name));
  }

  @Post("partitions/:name/remove")
  @HttpCode(200)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Remove an archived month past AUDIT_RETENTION_MONTHS from the database, with a reason" })
  remove(@CurrentActor() actor: Actor, @Param("name") name: string, @Body() body: RemoveDto) {
    return this.retention.remove(actor, partitionName(name), body.reason);
  }

  @Get("archives/:archiveId/file")
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Download a verified archive (gzipped JSON lines, one event per line)" })
  async file(@CurrentActor() actor: Actor, @Param("archiveId", ParseUUIDPipe) archiveId: string): Promise<StreamableFile> {
    const { fileName, body } = await this.retention.download(actor, archiveId);
    return new StreamableFile(body, { type: "application/gzip", disposition: `attachment; filename="${fileName}"`, length: body.length });
  }
}
