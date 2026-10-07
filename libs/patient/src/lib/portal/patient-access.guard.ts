import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenError, requestMetadataFrom, UnauthenticatedError } from "@healthcare/core";
import type { Request } from "express";
import { ProxyRefusedError } from "../proxy/proxy.errors";
import { PortalMfaPolicyService } from "../security/portal-mfa-policy.service";
import { PortalProxyService } from "../proxy/proxy.service";
import { type PortalPrincipal, PortalAccountService } from "./portal-account.service";

type PortalRequest = Request & { patientPrincipal?: PortalPrincipal };

const PROXY_ALLOWED = "portal:proxy-allowed";
const ALLOW_DURING_MFA_ENROLLMENT = "portal:allow-during-mfa-enrollment";

/**
 * Marks a portal route (or controller) a patient may use while their organization requires two-step verification they
 * have not set up (migration 0100): the profile, sign-out, and the email and two-step set-up routes. Everything else
 * answers `403 mfa_enrollment_required` until it is on.
 */
export const AllowDuringPortalMfaEnrollment = () => SetMetadata(ALLOW_DURING_MFA_ENROLLMENT, true);

/**
 * Marks a portal route (or a whole controller) as one a guardian may use while acting for a dependent. Routes without it
 * refuse `X-Acting-For`, so everything about the account holder's own sign-in, devices, notification settings and consents
 * stays theirs alone unless someone deliberately opens a route to guardians.
 */
export const ProxyAllowed = () => SetMetadata(PROXY_ALLOWED, true);

/** The header a guardian's client sends to act for a dependent: the dependent's patient id. */
export const ACTING_FOR_HEADER = "x-acting-for";

/**
 * Authenticates patient portal requests. Portal routes are @Public() for the
 * staff AccessGuard and use this guard instead; patient and staff tokens have
 * different audiences, so neither can be used on the other's routes.
 *
 * A request may name another person's record in `X-Acting-For` (guardian access): only on `@ProxyAllowed()` routes, and
 * only through a live grant (`PortalProxyService.actingFor`). The principal is then the dependent's patient with the
 * guardian's account and session, and the audit trail records the grant.
 */
@Injectable()
export class PatientAccessGuard implements CanActivate {
  constructor(
    private readonly accounts: PortalAccountService,
    private readonly proxies: PortalProxyService,
    private readonly mfaPolicy: PortalMfaPolicyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalRequest>();
    const match = /^Bearer (\S+)$/i.exec(request.header("authorization") ?? "");
    if (!match?.[1]) throw new UnauthenticatedError();
    const principal = await this.accounts.authenticate(match[1], requestMetadataFrom(request));
    // The account holder's own two-step verification state decides, whoever they act for.
    if (
      !principal.mfaEnabled &&
      !this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_DURING_MFA_ENROLLMENT, [context.getHandler(), context.getClass()])
    ) {
      const policy = await this.mfaPolicy.forAccount(principal.organizationId, principal.mfaEnabled, principal.mfaExempt);
      if (policy.enrollmentRequired) {
        throw new ForbiddenError("Your clinic requires two-step verification. Set it up under Sign-in security to continue.", "mfa_enrollment_required");
      }
    }
    const actingFor = request.header(ACTING_FOR_HEADER)?.trim();
    if (!actingFor || actingFor === principal.patientId) {
      request.patientPrincipal = principal;
      return true;
    }
    if (!this.reflector.getAllAndOverride<boolean | undefined>(PROXY_ALLOWED, [context.getHandler(), context.getClass()])) {
      throw new ProxyRefusedError("This is only available for your own account", "proxy_not_allowed");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actingFor)) {
      throw new ProxyRefusedError("You cannot act for this person any more", "proxy_not_allowed");
    }
    request.patientPrincipal = await this.proxies.actingFor(principal, actingFor, request.method);
    return true;
  }
}

export const CurrentPatient = createParamDecorator((_data: unknown, context: ExecutionContext): PortalPrincipal => {
  const principal = context.switchToHttp().getRequest<PortalRequest>().patientPrincipal;
  if (!principal) throw new UnauthorizedException();
  return principal;
});
