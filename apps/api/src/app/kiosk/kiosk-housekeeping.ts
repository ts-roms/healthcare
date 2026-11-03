import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { KioskRegistrationService } from "./kiosk-registration.service";
import { KioskSessionService } from "./kiosk-session.service";

const MINUTE_MS = 60_000;

/**
 * Closes what nobody closed (docs/domains/kiosk.md): sessions past their deadline, and registrations nobody reviewed
 * within 24 hours (their sealed content is erased). Both are single idempotent statements, so several API instances
 * can run it.
 */
@Injectable()
export class KioskHousekeeping implements OnApplicationShutdown {
  private readonly logger = new Logger(KioskHousekeeping.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly sessions: KioskSessionService,
    private readonly registrations: KioskRegistrationService,
  ) {}

  start(intervalMs = MINUTE_MS): void {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      const sessions = await this.sessions.expireDue();
      const registrations = await this.registrations.expireDue();
      if (registrations > 0) this.logger.log({ event: "kiosk.registrations_expired", registrations });
      if (sessions > 0) this.logger.debug({ event: "kiosk.sessions_expired", sessions });
    } catch (error) {
      this.logger.error(`Kiosk housekeeping failed: ${String(error)}`);
    }
  }
}
