import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Actor, CurrentActor, RequirePermissions } from '@healthcare/core';
import { ArchiveDocumentDto, CreateDocumentDto, ListDocumentsDto } from './document.dto';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermissions('document.upload')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Register a document and get a presigned upload URL (PUT the file, then call /complete)' })
  create(@CurrentActor() actor: Actor, @Body() body: CreateDocumentDto) {
    return this.documents.create(actor, body);
  }

  @Post(':documentId/complete')
  @HttpCode(200)
  @RequirePermissions('document.upload')
  complete(@CurrentActor() actor: Actor, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.completeUpload(actor, documentId);
  }

  @Get()
  @RequirePermissions('document.read')
  list(@CurrentActor() actor: Actor, @Query() query: ListDocumentsDto) {
    return this.documents.listForPatient(actor, query.patientId, query.includeArchived === 'true');
  }

  @Get(':documentId')
  @RequirePermissions('document.read')
  get(@CurrentActor() actor: Actor, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.get(actor, documentId);
  }

  @Get(':documentId/download-url')
  @RequirePermissions('document.read')
  @ApiOperation({ summary: 'Short-lived signed download URL (audited)' })
  downloadUrl(@CurrentActor() actor: Actor, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.documents.downloadUrl(actor, documentId);
  }

  @Post(':documentId/archive')
  @HttpCode(200)
  @RequirePermissions('document.archive')
  archive(@CurrentActor() actor: Actor, @Param('documentId', ParseUUIDPipe) documentId: string, @Body() body: ArchiveDocumentDto) {
    return this.documents.archive(actor, documentId, body.reason);
  }
}
