/**
 * The authenticated caller of a request. Built by the auth library and passed
 * explicitly to application services (no ambient/global request state).
 */
export interface Actor {
  kind: "user" | "system";
  userId: string;
  displayName: string;
  sessionId?: string;
  organizationId: string;
  /** Facility the request is acting in, from the X-Facility-Id header. */
  facilityId?: string;
  isPlatformAdmin: boolean;
  permissions: ReadonlySet<string>;
  /** The organization requires two-step verification and this member has not set it up (nor is exempt). */
  mfaEnrollmentRequired?: boolean;
  request: RequestMetadata;
}

export interface RequestMetadata {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}
