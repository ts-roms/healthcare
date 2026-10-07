import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig, DomainEventHandlers, type DomainEventRecord, systemActor } from "@healthcare/core";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { PATIENT_MFA_POLICY_CHANGED, PortalMfaPolicyService } from "@healthcare/patient";

const PAGE_SIZE = 200;

/**
 * Tells each MyHealth patient who still has to set two-step verification up, by email, when the clinic requires it or
 * moves its date (docs/architecture/portal-app.md, "Two-step verification"; D6 phase 2). One message per account and
 * policy version, so a repeated event sends nothing twice. Exempt accounts and accounts with it on are left out; the
 * recipient directory sends only to an account that can sign in. Turning the requirement off sends nothing.
 */
@Injectable()
export class PortalMfaPolicyNotices implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly handlers: DomainEventHandlers,
    private readonly policies: PortalMfaPolicyService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(PATIENT_MFA_POLICY_CHANGED, "portal.mfa-required-notice", (event) => this.notify(event));
  }

  private async notify(event: DomainEventRecord): Promise<void> {
    const payload = event.payload as { version?: number; requiredFrom?: string | null };
    if (typeof payload.version !== "number") return;
    const organization = await this.organizations.getOrganization(event.organizationId);
    const actor = systemActor(event.organizationId, null, "portal-mfa-required-notice");
    const link = this.config.PORTAL_BASE_URL ? `${this.config.PORTAL_BASE_URL}/security` : null;
    let after: string | null = null;
    for (;;) {
      const page = await this.policies.accountsToNotify(event.organizationId, after, PAGE_SIZE);
      for (const account of page) {
        await this.notifications.send(actor, {
          recipient: { type: "patient", patientId: account.patientId },
          channel: "email",
          templateKey: "portal.mfa-required-notice",
          variables: { organizationName: organization.name.slice(0, 80), requiredFrom: payload.requiredFrom ?? null, link },
          idempotencyKey: `portal-mfa-required:${payload.version}:${account.accountId}`,
        });
      }
      if (page.length < PAGE_SIZE) return;
      after = page.at(-1)!.accountId;
    }
  }
}
