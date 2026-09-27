import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../actor';
import { BadRequestError, UnauthenticatedError } from '../errors';
import '../http/request-augmentation';
import type { Permission } from './permissions';

/**
 * Access metadata read by the global guard registered in libs/auth.
 * Every route requires an authenticated caller unless marked @Public().
 */
export const ACCESS_METADATA = {
  public: 'access:public',
  permissions: 'access:permissions',
  platformAdmin: 'access:platform-admin',
  facility: 'access:facility',
} as const;

/** No authentication (login, health checks). Use sparingly. */
export const Public = () => SetMetadata(ACCESS_METADATA.public, true);

/** Caller must hold every listed permission in the current organization/facility. */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) => SetMetadata(ACCESS_METADATA.permissions, permissions);

/** Platform-level operations (e.g. creating organizations). */
export const RequirePlatformAdmin = () => SetMetadata(ACCESS_METADATA.platformAdmin, true);

/** Request must carry an X-Facility-Id header the caller has access to. */
export const RequireFacility = () => SetMetadata(ACCESS_METADATA.facility, true);

export const CurrentActor = createParamDecorator((_: unknown, context: ExecutionContext): Actor => {
  const actor = context.switchToHttp().getRequest<Request>().actor;
  if (!actor) throw new UnauthenticatedError();
  return actor;
});

/** Facility context of a route decorated with @RequireFacility(). */
export function requireFacilityId(actor: Actor): string {
  if (!actor.facilityId) throw new BadRequestError('X-Facility-Id header is required', 'facility_required');
  return actor.facilityId;
}
