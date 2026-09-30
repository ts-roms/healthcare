/** What the API returns to the app (mirrors the portal's `apps/portal/src/lib/api/types.ts`; only what the app uses). */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** When the refresh token stops working (ISO 8601). */
  refreshTokenExpiresAt: string;
}

export interface TokenResponse extends StoredSession {
  status: "authenticated";
  tokenType: "Bearer";
  expiresIn: number;
}

export interface MfaRequired {
  status: "mfa_required";
  challengeToken: string;
}

export interface Me {
  patient: { displayName: string; givenName: string };
  organization: { name: string };
  /** The clinic's time zone: times are shown in it. */
  timeZone: string;
}

export interface Notice {
  id: string;
  templateKey: string;
  subject: string | null;
  text: string;
  createdAt: string;
  readAt: string | null;
}

export interface PushDevice {
  id: string;
  label: string;
  kind: "web" | "expo";
  createdAt: string;
  lastSuccessAt: string | null;
}

export interface PushStatus {
  /** Push to browsers is offered. */
  configured: boolean;
  /** Push to this app is offered. */
  mobileConfigured: boolean;
  devices: PushDevice[];
  /** The device with the token asked about, if it is registered. */
  thisDeviceId: string | null;
}
