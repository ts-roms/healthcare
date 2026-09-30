import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, type OnModuleInit } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuditService } from "@healthcare/audit";
import { APP_CONFIG, type AppConfig, BusinessRuleError, Public, systemActor } from "@healthcare/core";
import { NotificationService, PushSubscriptionService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, PushDeviceCounts, type PortalPrincipal } from "@healthcare/patient";
import { createZodDto } from "nestjs-zod";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
class RegisterDeviceDto extends createZodDto(
  z.object({ endpoint: z.url().max(2048).startsWith("https://"), keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(10).max(100) }) }),
) {}
class PushStatusQueryDto extends createZodDto(z.object({ endpoint: z.url().max(2048).optional() })) {}

/**
 * The devices a patient has allowed to receive notifications (Web Push; docs/domains/notification.md, "Push"). Public to the
 * staff guard; the patient guard protects every request. Available only where the platform has its VAPID key pair.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/push", version: "1" })
export class PortalPushController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly devices: PushSubscriptionService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Whether push is offered, the key a browser subscribes with, the patient's devices, and which one is this browser (by its endpoint)",
  })
  async status(@CurrentPatient() patient: PortalPrincipal, @Query() query: PushStatusQueryDto) {
    const configured = Boolean(this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY && this.config.VAPID_SUBJECT);
    return {
      configured,
      vapidPublicKey: configured ? (this.config.VAPID_PUBLIC_KEY ?? null) : null,
      devices: await this.devices.list(patient.accountId),
      thisDeviceId: query.endpoint ? await this.devices.idOfEndpoint(patient.accountId, query.endpoint) : null,
    };
  }

  @Post("subscriptions")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Register this browser to receive notifications (up to 5 devices)" })
  async register(@CurrentPatient() patient: PortalPrincipal, @Body() body: RegisterDeviceDto, @Req() request: Request) {
    if (!this.config.VAPID_PUBLIC_KEY) throw new BusinessRuleError("Notifications on this device are not available at this clinic", "push_not_available");
    const device = await this.devices.register(patient.organizationId, patient.accountId, body, request.header("user-agent"));
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.push-register",
      resourceType: "push_subscription",
      resourceId: device.id,
      patientId: patient.patientId,
      metadata: { device: device.label },
    });
    return device;
  }

  @Post("subscriptions/:deviceId/remove")
  @HttpCode(204)
  @ApiOperation({ summary: "Stop notifications on one device" })
  async remove(@CurrentPatient() patient: PortalPrincipal, @Param("deviceId", ParseUUIDPipe) deviceId: string): Promise<void> {
    await this.devices.remove(patient.accountId, deviceId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.push-remove",
      resourceType: "push_subscription",
      resourceId: deviceId,
      patientId: patient.patientId,
    });
  }

  @Post("test")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send a test notification to the patient's devices" })
  async test(@CurrentPatient() patient: PortalPrincipal) {
    if (!(await this.devices.hasDevice(patient.accountId))) throw new BusinessRuleError("Turn on notifications on a device first", "no_push_device");
    const sent = await this.notifications.send(systemActor(patient.organizationId, null, "portal-push-test"), {
      recipient: { type: "patient", patientId: patient.patientId },
      channel: "push",
      templateKey: "portal.push-test",
      variables: { organizationName: (await this.organizations.getOrganization(patient.organizationId)).name.slice(0, 80) },
      idempotencyKey: `push-test:${randomUUID()}`,
    });
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.push-test",
      resourceType: "notification",
      resourceId: sent.id,
      patientId: patient.patientId,
    });
    return { status: sent.status };
  }
}

/** Tells the preferences service how many devices an account has (the devices belong to the notification platform). */
@Injectable()
export class PortalPushDevices implements OnModuleInit {
  constructor(
    private readonly counts: PushDeviceCounts,
    private readonly devices: PushSubscriptionService,
  ) {}

  onModuleInit(): void {
    this.counts.register(async (accountId) => (await this.devices.list(accountId)).length);
  }
}
