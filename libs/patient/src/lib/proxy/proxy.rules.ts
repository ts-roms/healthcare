export const PROXY_RELATIONSHIPS = ["parent", "legal_guardian", "caregiver", "spouse_or_partner", "adult_child", "other"] as const;
export type ProxyRelationship = (typeof PROXY_RELATIONSHIPS)[number];

export const PROXY_BASES = ["parent_of_minor", "legal_guardian", "authorized_by_patient", "other_authorized"] as const;
export type ProxyBasis = (typeof PROXY_BASES)[number];

export const PROXY_SCOPES = ["view", "act"] as const;
export type ProxyScope = (typeof PROXY_SCOPES)[number];

/** How many people one guardian may act for at once. */
export const MAX_DEPENDENTS_PER_GUARDIAN = 10;

/** The proxy on a request that acts for another person. */
export interface ProxyContext {
  grantId: string;
  /** The guardian's own patient record (their account's patient). */
  guardianPatientId: string;
  relationship: ProxyRelationship;
  scopes: ProxyScope[];
}

/** What a request needs of a grant: reading needs "view", anything that changes something needs "act". */
export function scopeNeeded(method: string): ProxyScope {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? "view" : "act";
}

export function grantAllows(scopes: readonly string[], method: string): boolean {
  return scopes.includes(scopeNeeded(method));
}

/** A grant is live: not ended and not past its end date. */
export function grantLive(grant: { revokedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt > now);
}
