import type { SessionTokens } from "@healthcare/web-session";

/** `POST /portal/auth/{activate,login,refresh}` */
export interface PortalTokenResponse extends SessionTokens {
  status: "authenticated";
  tokenType: "Bearer";
}

/** `GET /portal/me`: the signed-in patient's identity (no clinical data). */
export interface PortalMe {
  patient: {
    displayName: string;
    givenName: string;
    familyName: string;
    patientNumber: string;
    birthDate: string;
    sex: string;
  };
  organization: { name: string };
  account: { email: string };
}
