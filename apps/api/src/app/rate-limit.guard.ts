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

  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const request = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
    // The registered route template (`/api/v1/portal/auth/login`, `:id` for parameters), never the actual address.
    void this.refusals.recordRefusal(`${request.method ?? "?"} ${request.route?.path ?? "unknown"}`);
    return super.throwThrottlingException(context, detail);
  }
}
