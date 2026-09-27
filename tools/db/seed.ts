/**
 * Bootstraps an empty database with the first organization, facility and a
 * platform administrator: `pnpm db:seed`. Safe to re-run (idempotent).
 *
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD   required
 *   SEED_ORG_CODE / SEED_ORG_NAME           default: demo / Demo Health
 *   SEED_FACILITY_CODE / SEED_FACILITY_NAME default: main / Main Clinic
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!email || !password || password.length < 12) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters)");
  }
  const orgCode = process.env.SEED_ORG_CODE ?? "demo";
  const orgName = process.env.SEED_ORG_NAME ?? "Demo Health";
  const facilityCode = process.env.SEED_FACILITY_CODE ?? "main";
  const facilityName = process.env.SEED_FACILITY_NAME ?? "Main Clinic";

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query<{ id: string }>(
      `INSERT INTO organization (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [orgCode, orgName],
    );
    const organizationId = org.rows[0]!.id;
    const facility = await client.query<{ id: string }>(
      `INSERT INTO facility (organization_id, code, name, facility_type) VALUES ($1, $2, $3, 'clinic')
       ON CONFLICT (organization_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [organizationId, facilityCode, facilityName],
    );
    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const user = await client.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name, password_hash, is_platform_admin) VALUES ($1, 'Platform Administrator', $2, true)
       ON CONFLICT (email) DO UPDATE SET is_platform_admin = true RETURNING id`,
      [email, passwordHash],
    );
    const userId = user.rows[0]!.id;
    await client.query(`INSERT INTO organization_membership (organization_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [organizationId, userId]);
    await client.query(
      `INSERT INTO role_assignment (organization_id, user_id, role_id)
       SELECT $1, $2, id FROM role WHERE key = 'org_admin' AND is_system
       ON CONFLICT DO NOTHING`,
      [organizationId, userId],
    );
    await client.query(
      `INSERT INTO audit_event (organization_id, actor_type, action, resource_type, resource_id, outcome, metadata)
       VALUES ($1::uuid, 'system', 'system.seed', 'organization', $1::text, 'success', $2)`,
      [organizationId, JSON.stringify({ adminUserId: userId, facilityId: facility.rows[0]!.id })],
    );
    await client.query("COMMIT");
    console.log(`Seeded organization "${orgCode}" (${organizationId}), facility "${facilityCode}" (${facility.rows[0]!.id}), admin ${email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
