import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@healthcare/core";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { OBJECT_STORAGE, S3ObjectStorage } from "./object-storage";

export interface DocumentsModuleOptions {
  /** Override the object storage adapter (tests, alternative providers). */
  storage?: Provider;
}

@Module({})
export class DocumentsModule {
  static forRoot(options: DocumentsModuleOptions = {}): DynamicModule {
    const storage: Provider = options.storage ?? {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new S3ObjectStorage(config),
    };
    return {
      module: DocumentsModule,
      controllers: [DocumentsController],
      providers: [DocumentsService, storage],
      exports: [DocumentsService],
    };
  }
}
