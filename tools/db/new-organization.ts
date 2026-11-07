/**
 * Creates another organization with its first facility and an organization administrator: `pnpm db:org:new`.
 * Unlike `pnpm db:seed` (the very first organization and the platform administrator), this never makes anyone a
 * platform administrator. Safe to re-run: the organization, facility, user, membership and role are reused.
 *
 *   pnpm db:org:new --code acme --name "Acme Health" --admin-email admin@acme.ph [options]
 *
 *   --code            organization code, lowercase letters, digits and hyphens (required)
 *   --name            organization name (required)
 *   --admin-email     first organization administrator (required)
 *   --admin-name      display name of that administrator (default: Organization Administrator)
 *   --facility-code   default: main
 *   --facility-name   default: Main Clinic
 *   --facility-type   default: clinic
 *   --timezone        default: Asia/Manila
 *
 * Password: NEW_ORG_ADMIN_PASSWORD (at least 12 characters) when the administrator is new; otherwise a random
 * temporary password is printed once, and the administrator must replace it at the first sign-in. An administrator
 * who already has an account keeps their password and is only added to the organization.
 *
 * Uses MIGRATION_DATABASE_URL, else DATABASE_URL. Add --dry-run to check the arguments without writing.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { describeError } from "./describe-error";

const CODE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const FACILITY_TYPES = ["clinic", "laboratory", "dental_clinic", "hospital", "diagnostic_center", "telemedicine_hub", "pharmacy", "other"];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      code: { type: "string" },
      name: { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string", default: "Organization Administrator" },
      "facility-code": { type: "string", default: "main" },
      "facility-name": { type: "string", default: "Main Clinic" },
      "facility-type": { type: "string", default: "clinic" },
      timezone: { type: "string", default: "Asia/Manila" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const orgCode = values.code?.trim();
  const orgName = values.name?.trim();
  const email = values["admin-email"]?.trim().toLowerCase();
  const adminName = values["admin-name"]!.trim();
  const facilityCode = values["facility-code"]!.trim();
  const facilityName = values["facility-name"]!.trim();
  const facilityType = values["facility-type"]!;
  const timezone = values.timezone!;

  if (!orgCode || !orgName || !email) throw new Error("--code, --name and --admin-email are required");
  if (!CODE.test(orgCode)) throw new Error("--code must be 2-49 lowercase letters, digits or hyphens, starting with a letter or digit");
  if (!CODE.test(facilityCode)) throw new Error("--facility-code must be 2-49 lowercase letters, digits or hyphens");
  if (!FACILITY_TYPES.includes(facilityType)) throw new Error(`--facility-type must be one of: ${FACILITY_TYPES.join(", ")}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--admin-email is not a valid email address");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new Error(`--timezone "${timezone}" is not a valid time zone`);
  }
  const suppliedPassword = process.env.NEW_ORG_ADMIN_PASSWORD;
  if (suppliedPassword !== undefined && suppliedPassword.length < 12) throw new Error("NEW_ORG_ADMIN_PASSWORD must be at least 12 characters");
  if (values["dry-run"]) {
    console.log(`Dry run: would create organization "${orgCode}" (${orgName}), facility "${facilityCode}" (${facilityType}), administrator ${email}`);
    return;
  }

  const pool = new Pool({ connectionString: url, max: 1, options: "-c app.scope=all" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(`SELECT id FROM organization WHERE code = $1`, [orgCode]);
    const org = await client.query<{ id: string }>(
      `INSERT INTO organization (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [orgCode, orgName],
    );
    const organizationId = org.rows[0]!.id;
    const facility = await client.query<{ id: string }>(
      `INSERT INTO facility (organization_id, code, name, facility_type, timezone) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [organizationId, facilityCode, facilityName, facilityType, timezone],
    );

    const found = await client.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email]);
    let userId = found.rows[0]?.id;
    let temporaryPassword: string | undefined;
    if (!userId) {
      const password = suppliedPassword ?? (temporaryPassword = randomBytes(15).toString("base64url"));
      const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const created = await client.query<{ id: string }>(
        `INSERT INTO app_user (email, display_name, password_hash, password_change_required) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, adminName, passwordHash, temporaryPassword !== undefined],
      );
      userId = created.rows[0]!.id;
    }
    await client.query(`INSERT INTO organization_membership (organization_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [organizationId, userId]);
    const role = await client.query(
      `INSERT INTO role_assignment (organization_id, user_id, role_id)
       SELECT $1, $2, id FROM role WHERE key = 'org_admin' AND is_system
       ON CONFLICT DO NOTHING`,
      [organizationId, userId],
    );
    await client.query(
      `INSERT INTO audit_event (organization_id, actor_type, action, resource_type, resource_id, outcome, metadata)
       VALUES ($1::uuid, 'system', 'system.organization-create', 'organization', $1::text, 'success', $2)`,
      [organizationId, JSON.stringify({ adminUserId: userId, facilityId: facility.rows[0]!.id, reused: existing.rows.length > 0 })],
    );
    await client.query("COMMIT");

    console.log(`${existing.rows.length > 0 ? "Updated" : "Created"} organization "${orgCode}" (${organizationId})`);
    console.log(`  facility "${facilityCode}" (${facility.rows[0]!.id})`);
    console.log(`  administrator ${email} (${userId})${role.rowCount === 0 ? " — already an org_admin" : ""}`);
    if (temporaryPassword) {
      console.log(`  temporary password (shown once, replaced at first sign-in): ${temporaryPassword}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
