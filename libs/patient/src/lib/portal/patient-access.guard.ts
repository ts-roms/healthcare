import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { requestMetadataFrom, UnauthenticatedError } from "@healthcare/core";
import type { Request } from "express";
import { type PortalPrincipal, PortalAccountService } from "./portal-account.service";

type PortalRequest = Request & { patientPrincipal?: PortalPrincipal };

/**
 * Authenticates patient portal requests. Portal routes are @Public() for the
 * staff AccessGuard and use this guard instead; patient and staff tokens have
 * different audiences, so neither can be used on the other's routes.
 */
@Injectable()
export class PatientAccessGuard implements CanActivate {
  constructor(private readonly accounts: PortalAccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalRequest>();
    const match = /^Bearer (\S+)$/i.exec(request.header("authorization") ?? "");
    if (!match?.[1]) throw new UnauthenticatedError();
    request.patientPrincipal = await this.accounts.authenticate(match[1], requestMetadataFrom(request));
    return true;
  }
}

export const CurrentPatient = createParamDecorator((_data: unknown, context: ExecutionContext): PortalPrincipal => {
  const principal = context.switchToHttp().getRequest<PortalRequest>().patientPrincipal;
  if (!principal) throw new UnauthorizedException();
  return principal;
});
