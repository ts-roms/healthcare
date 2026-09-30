import type { ProxyBasis, ProxyRelationship, ProxyScope } from "./proxy.rules";

/** A person a MyHealth account holder may act for, as that holder sees it. */
export interface ProxyDependentView {
  grantId: string;
  patientId: string;
  displayName: string;
  relationship: ProxyRelationship;
  scopes: ProxyScope[];
  grantedAt: string;
  expiresAt: string | null;
}

/** A person who may act for the account holder, as the holder sees it. */
export interface ProxyGuardianView {
  grantId: string;
  displayName: string;
  relationship: ProxyRelationship;
  scopes: ProxyScope[];
  grantedAt: string;
  expiresAt: string | null;
}

/** One grant as the clinic sees it. */
export interface StaffProxyGrantView {
  id: string;
  guardianPatientId: string;
  guardianName: string;
  guardianNumber: string;
  dependentPatientId: string;
  dependentName: string;
  dependentNumber: string;
  relationship: ProxyRelationship;
  basis: ProxyBasis;
  scopes: ProxyScope[];
  verificationNote: string;
  grantedAt: string;
  grantedByName: string | null;
  expiresAt: string | null;
  /** Live: not ended and not past its end date. */
  live: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  revokedBy: "staff" | "patient" | null;
}

export interface StaffProxyOverview {
  /** People who may act for this patient. */
  actedForBy: StaffProxyGrantView[];
  /** People this patient may act for. */
  actingFor: StaffProxyGrantView[];
}
