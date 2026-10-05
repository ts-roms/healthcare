import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuditService } from "@healthcare/audit";
import { type Actor, APP_CONFIG, type AppConfig, BusinessRuleError, CurrentActor, systemActor } from "@healthcare/core";
import { NotificationService, PushSubscriptionService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { createZodDto } from "nestjs-zod";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
class RegisterStaffDeviceDto extends createZodDto(
  z.object({ endpoint: z.url().max(2048).startsWith("https://"), keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(10).max(100) }) }),
) {}
class StaffPushStatusQueryDto extends createZodDto(z.object({ endpoint: z.url().max(2048).optional() })) {}

/**
 * The browsers a staff member has allowed to receive notifications (Web Push; docs/domains/notification.md, "Push";
 * migration 0101). Every signed-in member may register their own browser — no permission beyond signing in. A push
 * mirrors an in-app notice the member gets anyway, with its content-free push wording. Available only where the
 * platform has its VAPID key pair.
 */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller({ path: "me/push", version: "1" })
export class StaffPushController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly devices: PushSubscriptionService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Whether push is offered, the key a browser subscribes with, the member's browsers, and which one is this browser (by its endpoint)",
  })
  async status(@CurrentActor() actor: Actor, @Query() query: StaffPushStatusQueryDto) {
    const configured = Boolean(this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY && this.config.VAPID_SUBJECT);
    return {
      configured,
      vapidPublicKey: configured ? (this.config.VAPID_PUBLIC_KEY ?? null) : null,
      devices: await this.devices.list(actor.userId),
      thisDeviceId: query.endpoint ? await this.devices.idOfEndpoint(actor.userId, query.endpoint) : null,
    };
  }

  @Post("subscriptions")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Register this browser to receive notifications (up to 5 browsers)" })
  async register(@CurrentActor() actor: Actor, @Body() body: RegisterStaffDeviceDto, @Req() request: Request) {
    if (!this.config.VAPID_PUBLIC_KEY) throw new BusinessRuleError("Notifications in the browser are not available on this platform", "push_not_available");
    const device = await this.devices.registerForUser(actor.organizationId, actor.userId, body, request.header("user-agent"));
    await this.audit.recordStandalone(actor, {
      action: "auth.push-register",
      resourceType: "push_subscription",
      resourceId: device.id,
      metadata: { device: device.label },
    });
    return device;
  }

  @Post("subscriptions/:deviceId/remove")
  @HttpCode(204)
  @ApiOperation({ summary: "Stop notifications on one browser" })
  async remove(@CurrentActor() actor: Actor, @Param("deviceId", ParseUUIDPipe) deviceId: string): Promise<void> {
    await this.devices.remove(actor.userId, deviceId, "removed_by_user");
    await this.audit.recordStandalone(actor, { action: "auth.push-remove", resourceType: "push_subscription", resourceId: deviceId });
  }

  @Post("test")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send a test notification to the member's browsers" })
  async test(@CurrentActor() actor: Actor) {
    if (!(await this.devices.hasDevice(actor.userId))) throw new BusinessRuleError("Turn on notifications in a browser first", "no_push_device");
    const sent = await this.notifications.send(systemActor(actor.organizationId, null, "staff-push-test"), {
      recipient: { type: "user", userId: actor.userId },
      channel: "push",
      templateKey: "staff.push-test",
      variables: { organizationName: (await this.organizations.getOrganization(actor.organizationId)).name.slice(0, 80) },
      idempotencyKey: `staff-push-test:${randomUUID()}`,
    });
    await this.audit.recordStandalone(actor, { action: "auth.push-test", resourceType: "notification", resourceId: sent.id });
    return { status: sent.status };
  }
}
