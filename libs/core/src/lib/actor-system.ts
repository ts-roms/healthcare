import type { Actor } from "./actor";

/**
 * Actor for work the platform does on its own (event handlers, schedulers).
 * Audited as actor type "system"; it has no user id and no permissions.
 */
export function systemActor(organizationId: string, facilityId?: string | null, reason?: string): Actor {
  return {
    kind: "system",
    userId: "system",
    displayName: reason ? `system:${reason}` : "system",
    organizationId,
    facilityId: facilityId ?? undefined,
    isPlatformAdmin: false,
    permissions: new Set(),
    request: {},
  };
}

/** The user id to store in created_by-style columns, or null for system actors. */
export function actorUserId(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}
