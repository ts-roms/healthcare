/**
 * Response shapes of the MyHealth API (`/api/v1/portal/*`) that this app uses. Results come from
 * `@healthcare/domain/portal-results`, shared with MyHealth on the web; the rest mirror the API by hand, as the web
 * apps do (`apps/portal/src/lib/api/types.ts`), until contract libraries exist.
 */
export type { PortalResult, PortalTrend } from "@healthcare/domain/portal-results";

/** `POST /portal/auth/login`, `/auth/mfa/verify`, `/auth/refresh` */
export interface PortalTokenResponse {
  status: "authenticated";
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/** `POST /portal/auth/login` when the account uses two-step verification. */
export interface PortalMfaRequired {
  status: "mfa_required";
  challengeToken: string;
}

/** `GET /portal/me` (only the fields this app reads). */
export interface PortalMe {
  patient: { displayName: string; givenName: string; patientNumber: string };
  organization: { name: string };
  /** The patient's clinic's time zone: dates are shown in it. */
  timeZone: string;
}

/** A device that receives this account's notifications (`GET /portal/push`). */
export interface PushDevice {
  id: string;
  label: string;
  kind: "web" | "expo";
  createdAt: string;
  lastSuccessAt: string | null;
}

/** `GET /portal/push` */
export interface PushStatus {
  /** Push to browsers is offered. */
  configured: boolean;
  /** Push to this app is offered (`EXPO_PUSH_ENABLED`). */
  mobileConfigured: boolean;
  devices: PushDevice[];
  /** The device with the token asked about, if it is registered. */
  thisDeviceId: string | null;
}
