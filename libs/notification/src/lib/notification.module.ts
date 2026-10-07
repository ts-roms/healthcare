import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
  type Type,
} from "@nestjs/common";
import { APP_CONFIG, type AppConfig, DATABASE } from "@healthcare/core";
import { BullMqNotificationQueue, NotificationWorkerRunner } from "./bullmq";
import { defaultChannelSenders } from "./channel-senders";
import { NotificationController } from "./notification.controller";
import { NotificationDispatcher } from "./notification.dispatcher";
import { NotificationService } from "./notification.service";
import { EXPO_PUSH_TRANSPORT, ExpoPushReceipts } from "./push/expo-push-receipts";
import { LibraryExpoPushTransport } from "./push/expo-push.transport";
import { PushSubscriptionService } from "./push/push-subscription.service";
import { StaffPushPreferenceService } from "./push/staff-push-preference.service";
import { CHANNEL_SENDERS, NOTIFICATION_QUEUE, type NotificationQueue, RECIPIENT_DIRECTORY, type RecipientDirectory } from "./ports";

const bullMqQueue: Provider = {
  provide: NOTIFICATION_QUEUE,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new BullMqNotificationQueue(config.REDIS_URL),
};

export interface NotificationModuleOptions {
  /** Modules that provide what the recipient directory depends on. */
  imports?: ModuleMetadata["imports"];
  recipientDirectory: Type<RecipientDirectory>;
  /** Override the queue (tests). Defaults to BullMQ on REDIS_URL. */
  queue?: Provider;
}

/** API side: accepts, records and enqueues notifications. */
@Module({})
export class NotificationModule {
  static forRoot(options: NotificationModuleOptions): DynamicModule {
    return {
      module: NotificationModule,
      // Global so domain modules (e.g. clinic reminders) can inject NotificationService.
      global: true,
      imports: options.imports ?? [],
      controllers: [NotificationController],
      providers: [
        NotificationService,
        PushSubscriptionService,
        StaffPushPreferenceService,
        { provide: RECIPIENT_DIRECTORY, useClass: options.recipientDirectory },
        options.queue ?? bullMqQueue,
      ],
      exports: [NotificationService, PushSubscriptionService, StaffPushPreferenceService],
    };
  }
}

export interface NotificationWorkerModuleOptions {
  /** Override channel adapters (tests, real providers). */
  senders?: Provider;
  queue?: Provider;
  /** Start consuming the queue on bootstrap (false in tests). */
  autoStart?: boolean;
  /** Override the Expo push service used to read receipts (tests). */
  expoTransport?: Provider;
}

class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly runner: NotificationWorkerRunner,
    private readonly autoStart: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.autoStart) this.runner.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner.stop();
  }
}

/** Worker side: delivers queued notifications through channel adapters. */
@Module({})
export class NotificationWorkerModule {
  static forRoot(options: NotificationWorkerModuleOptions = {}): DynamicModule {
    return {
      module: NotificationWorkerModule,
      providers: [
        NotificationDispatcher,
        options.queue ?? bullMqQueue,
        options.senders ?? { provide: CHANNEL_SENDERS, inject: [APP_CONFIG, DATABASE], useFactory: defaultChannelSenders },
        {
          provide: NotificationWorkerRunner,
          inject: [APP_CONFIG, NotificationDispatcher, NOTIFICATION_QUEUE],
          useFactory: (config: AppConfig, dispatcher: NotificationDispatcher, queue: NotificationQueue) =>
            new NotificationWorkerRunner(config.REDIS_URL, dispatcher, queue),
        },
        {
          provide: WorkerLifecycle,
          inject: [NotificationWorkerRunner],
          useFactory: (runner: NotificationWorkerRunner) => new WorkerLifecycle(runner, options.autoStart ?? true),
        },
        options.expoTransport ?? {
          provide: EXPO_PUSH_TRANSPORT,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => new LibraryExpoPushTransport(config.EXPO_ACCESS_TOKEN),
        },
        ExpoPushReceipts,
      ],
      exports: [NotificationDispatcher, ExpoPushReceipts],
    };
  }
}
