/**
 * Recreates the end-to-end database before the API starts: drop, create, migrate (tools/db/migrate.ts), then the
 * tenant and its staff. Everything else (visit types, schedules, the laboratory catalog, patients) is set up through
 * the API by tests/setup.setup.ts, so the journeys start from data the application itself validated.
 *
 * Run by the API web server in playwright.config.ts: node -r @swc-node/register apps/e2e/support/prepare-database.ts
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import { Client } from "pg";
import { DOCTOR_NAME, E2E_DATABASE_URL, ORGANIZATION_CODE, STAFF, STAFF_PASSWORD, TELE_DOCTOR_NAME } from "./env";

async function recreate(url: string): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("e2e")) throw new Error(`Refusing to recreate "${name}": the e2e database name must contain "e2e"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}

async function seed(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query<{ id: string }>(`INSERT INTO organization (code, name) VALUES ($1, 'E2E Health') RETURNING id`, [ORGANIZATION_CODE]);
    const organizationId = org.rows[0]!.id;
    await client.query(`INSERT INTO facility (organization_id, code, name, facility_type) VALUES ($1, 'main', 'E2E Main Clinic', 'clinic')`, [organizationId]);
    const passwordHash = await hash(STAFF_PASSWORD);
    const staff: Array<{ email: string; name: string; role: string; profession?: string }> = [
      { email: STAFF.admin, name: "E2E Administrator", role: "org_admin" },
      { email: STAFF.desk, name: "Rosa Desk", role: "receptionist" },
      { email: STAFF.doctor, name: DOCTOR_NAME, role: "physician", profession: "physician" },
      { email: STAFF.teleDoctor, name: TELE_DOCTOR_NAME, role: "physician", profession: "physician" },
      { email: STAFF.medtech, name: "Carlo Medtech", role: "medical_technologist" },
      { email: STAFF.pathologist, name: "Dr. Lea Pathologist", role: "pathologist" },
      { email: STAFF.cashier, name: "Nina Cashier", role: "cashier" },
    ];
    for (const s of staff) {
      const user = await client.query<{ id: string }>(`INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [
        s.email,
        s.name,
        passwordHash,
      ]);
      const userId = user.rows[0]!.id;
      await client.query(`INSERT INTO organization_membership (organization_id, user_id) VALUES ($1, $2)`, [organizationId, userId]);
      await client.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) SELECT $1, $2, id FROM role WHERE key = $3 AND is_system`, [
        organizationId,
        userId,
        s.role,
      ]);
      if (s.profession) {
        await client.query(
          `INSERT INTO practitioner (organization_id, user_id, display_name, profession, license_number) VALUES ($1, $2, $3, $4, 'PRC-E2E-0001')`,
          [organizationId, userId, s.name, s.profession],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await recreate(E2E_DATABASE_URL);
  execFileSync(process.execPath, ["-r", "@swc-node/register", join(__dirname, "../../../tools/db/migrate.ts"), E2E_DATABASE_URL], { stdio: "inherit" });
  await seed(E2E_DATABASE_URL);
  console.log(`e2e database ready: ${new URL(E2E_DATABASE_URL).pathname.slice(1)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
