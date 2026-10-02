import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { DocumentRecordQueries } from "./document-record.queries";
import { DocumentRetentionController } from "./document-retention.controller";
import { DocumentRetentionService } from "./document-retention.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { ClamAvScanner, MALWARE_SCANNER, type MalwareScanner, UnconfiguredMalwareScanner } from "./malware-scanner";
import { OBJECT_STORAGE, S3ObjectStorage } from "./object-storage";

export interface DocumentsModuleOptions {
  /** Override the object storage adapter (tests, alternative providers). */
  storage?: Provider;
  /** Override the malware scanner (tests, alternative engines). */
  scanner?: Provider;
}

/** clamd when CLAMAV_HOST is set, else the unconfigured scanner (every completed upload recorded as not scanned). */
export function malwareScannerFor(config: AppConfig): MalwareScanner {
  return config.CLAMAV_HOST
    ? new ClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT, timeoutMs: config.CLAMAV_TIMEOUT_MS })
    : new UnconfiguredMalwareScanner();
}

@Module({})
export class DocumentsModule {
  static forRoot(options: DocumentsModuleOptions = {}): DynamicModule {
    const storage: Provider = options.storage ?? {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new S3ObjectStorage(config),
    };
    const scanner: Provider = options.scanner ?? { provide: MALWARE_SCANNER, inject: [APP_CONFIG], useFactory: malwareScannerFor };
    return {
      module: DocumentsModule,
      // Global so domain modules (e.g. patient consent) can check documents without re-registering the controller.
      global: true,
      controllers: [DocumentsController, DocumentRetentionController],
      providers: [DocumentsService, DocumentRecordQueries, DocumentRetentionService, storage, scanner],
      exports: [DocumentsService, DocumentRecordQueries],
    };
  }
}
