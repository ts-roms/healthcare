import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ProxyBasis, ProxyRelationship, ProxyScope } from "./proxy.rules";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors database/migrations/0080_portal_proxy_access.sql (the migration is the source of truth). */
export const portalProxyGrant = pgTable("portal_proxy_grant", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  guardianPatientId: uuid("guardian_patient_id").notNull(),
  dependentPatientId: uuid("dependent_patient_id").notNull(),
  relationship: text("relationship").$type<ProxyRelationship>().notNull(),
  basis: text("basis").$type<ProxyBasis>().notNull(),
  scopes: text("scopes").array().$type<ProxyScope[]>().notNull(),
  verificationNote: text("verification_note").notNull(),
  grantedBy: uuid("granted_by").notNull(),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  revokedByUser: uuid("revoked_by_user"),
  revokedByPortalAccount: uuid("revoked_by_portal_account"),
  revokedReason: text("revoked_reason"),
});

export type PortalProxyGrantRecord = typeof portalProxyGrant.$inferSelect;
