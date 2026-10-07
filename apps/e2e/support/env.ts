/**
 * The end-to-end environment: its own database and ports, so a run never touches the development database or
 * servers. Override with E2E_* variables (e.g. in CI).
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://healthcare:healthcare@localhost:5432/healthcare_e2e";
/**
 * The API connects as a restricted login role, a member of `healthcare_app` (0109_app_role.sql), as production should
 * (docs/runbooks/database-roles.md); the database is prepared, migrated and seeded as the owner above.
 */
export const E2E_APP_ROLE = { name: "healthcare_e2e_app", password: "e2e-only-app-role" };
export const E2E_APP_DATABASE_URL = process.env.E2E_APP_DATABASE_URL ?? withRole(E2E_DATABASE_URL, E2E_APP_ROLE);

function withRole(ownerUrl: string, role: { name: string; password: string }): string {
  const url = new URL(ownerUrl);
  url.username = role.name;
  url.password = role.password;
  return url.toString();
}

export const REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6379";

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3433);
export const STAFF_PORT = Number(process.env.E2E_STAFF_PORT ?? 3100);
export const PORTAL_PORT = Number(process.env.E2E_PORTAL_PORT ?? 3101);

export const API_URL = `http://localhost:${API_PORT}/api/v1`;
export const STAFF_URL = `http://localhost:${STAFF_PORT}`;
export const PORTAL_URL = `http://localhost:${PORTAL_PORT}`;

export const ORGANIZATION_CODE = "e2e";
/** Every seeded staff user signs in with this password (test data only). */
export const STAFF_PASSWORD = "E2E-Staff-Passphrase-1";
export const PATIENT_PASSWORD = "E2E-Patient-Passphrase-1";

/** Seeded staff (support/prepare-database.ts). */
export const STAFF = {
  admin: "admin@e2e.ph",
  desk: "desk@e2e.ph",
  doctor: "dr.santos@e2e.ph",
  /** Holds online consultations (journey 2), so their times never collide with journey 1's clinic visit. */
  teleDoctor: "dr.ramos@e2e.ph",
  medtech: "medtech@e2e.ph",
  pathologist: "patho@e2e.ph",
  /** Cashier role only (no organization.read): must still be able to choose the clinic. */
  cashier: "cashier@e2e.ph",
} as const;

export const DOCTOR_NAME = "Dr. Maria Santos";
export const TELE_DOCTOR_NAME = "Dr. Jose Ramos";
