import { type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from "@nestjs/throttler";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

const KIOSK_URL = /^\/api\/v\d+\/kiosk\//;

/**
 * The rate limiter, counting each refusal by route and day for platform administrators
 * (docs/security/access-control.md, "Shared addresses"): whether patients on shared addresses (carrier NAT) are being
 * refused is measured before any limit is changed. The count names the route template only.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly refusals: RedisThrottlerStorage,
  ) {
    super(options, storageService, reflector);
  }

  /** Kiosk routes are counted by `DeviceRateLimitGuard` (per signed-in device account), which runs after the access guard. */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ originalUrl?: string }>();
    return KIOSK_URL.test(request.originalUrl ?? "");
  }

  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const request = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
    // The registered route template (`/api/v1/portal/auth/login`, `:id` for parameters), never the actual address.
    void this.refusals.recordRefusal(`${request.method ?? "?"} ${request.route?.path ?? "unknown"}`);
    return super.throwThrottlingException(context, detail);
  }
}

/**
 * The rate limiter for kiosk, print agent and waiting-room screen routes (docs/security/kiosk-audit-phase-6.md, KA-07).
 * It is applied on the controllers, so it runs after the global access guard has set the verified actor, and counts per
 * signed-in device account instead of per network address: kiosks in one clinic share an address, so one busy kiosk must
 * not use up the others' allowance, and a stolen device token cannot spread its guesses across addresses.
 */
@Injectable()
export class DeviceRateLimitGuard extends RateLimitGuard {
  protected override async shouldSkip(): Promise<boolean> {
    return false;
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const actor = req["actor"] as { userId?: string } | undefined;
    return actor?.userId ? `device:${actor.userId}` : super.getTracker(req);
  }
}
