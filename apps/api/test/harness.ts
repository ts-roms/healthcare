import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { hashPassword } from "@healthcare/auth";
import { type AppConfig, loadAppConfig, OutboxRelay, runMigrations } from "@healthcare/core";
import { InMemoryObjectStorage, OBJECT_STORAGE } from "@healthcare/documents";
import { INTEGRATION_QUEUE, type IntegrationQueue } from "@healthcare/interoperability";
import { LAB_REPORT_ARCHIVE_QUEUE, type LabReportArchiveQueue } from "@healthcare/laboratory";
import { NOTIFICATION_QUEUE, type NotificationQueue } from "@healthcare/notification";
import { Pool } from "pg";
import request from "supertest";
import { AppModule, type AppModuleOverrides } from "../src/app/app.module";
import { configureApp } from "../src/app/configure-app";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://healthcare:healthcare@localhost:5432/healthcare_test";
export const PASSWORD = "Correct-Horse-Battery-9";

export class RecordingQueue implements NotificationQueue {
  readonly enqueued: string[] = [];
  async enqueue(notificationId: string): Promise<void> {
    this.enqueued.push(notificationId);
  }
}

/** Records exchanges handed to the integration worker (tests drive the worker's processor directly). */
export class RecordingIntegrationQueue implements IntegrationQueue {
  readonly enqueued: string[] = [];
  async enqueue(exchangeId: string): Promise<void> {
    this.enqueued.push(exchangeId);
  }
}

/** Records laboratory report archives handed to the queue (tests run the consumer, LabReportArchive.process, directly). */
export class RecordingArchiveQueue implements LabReportArchiveQueue {
  readonly enqueued: string[] = [];
  async enqueue(archiveId: string): Promise<void> {
    this.enqueued.push(archiveId);
  }
}

export interface TestContext {
  app: INestApplication;
  pool: Pool;
  config: AppConfig;
  storage: InMemoryObjectStorage;
  queue: RecordingQueue;
  integrations: RecordingIntegrationQueue;
  archives: RecordingArchiveQueue;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Test configuration; `env` adds or replaces variables (e.g. an integration payload key ring). */
export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    LOG_LEVEL: "error",
    // Video tokens are signed locally; no LiveKit server is contacted in tests.
    LIVEKIT_URL: "wss://video.test.invalid",
    LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: randomBytes(32).toString("hex"),
    ...env,
  });
}

/** Recreates the schema from migrations: every test file starts from an empty, fully migrated database. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool, join(__dirname, "../../../database/migrations"));
}

export async function createTestApp(
  overrides: Pick<AppModuleOverrides, "philhealthGateway" | "philhealthEligibilityGateway" | "dohGateway"> = {},
  env: Record<string, string> = {},
): Promise<TestContext> {
  const integrations = new RecordingIntegrationQueue();
  const archives = new RecordingArchiveQueue();
  const config = testConfig(env);
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  await resetDatabase(pool);
  const storage = new InMemoryObjectStorage();
  const queue = new RecordingQueue();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot(config, {
        objectStorage: { provide: OBJECT_STORAGE, useValue: storage },
        notificationQueue: { provide: NOTIFICATION_QUEUE, useValue: queue },
        disableRateLimit: true,
        integrationQueue: { provide: INTEGRATION_QUEUE, useValue: integrations },
        labReportArchiveQueue: { provide: LAB_REPORT_ARCHIVE_QUEUE, useValue: archives },
        ...overrides,
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return {
    app,
    pool,
    config,
    storage,
    queue,
    integrations,
    archives,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export interface Tenant {
  organizationId: string;
  facilityId: string;
  otherFacilityId: string;
}

export async function createTenant(pool: Pool, code: string): Promise<Tenant> {
  const org = await pool.query<{ id: string }>(`INSERT INTO organization (code, name) VALUES ($1, $2) RETURNING id`, [code, `Org ${code}`]);
  const organizationId = org.rows[0]!.id;
  const main = await pool.query<{ id: string }>(
    `INSERT INTO facility (organization_id, code, name, facility_type) VALUES ($1, 'main', 'Main Clinic', 'clinic') RETURNING id`,
    [organizationId],
  );
  const annex = await pool.query<{ id: string }>(
    `INSERT INTO facility (organization_id, code, name, facility_type) VALUES ($1, 'annex', 'Annex Clinic', 'clinic') RETURNING id`,
    [organizationId],
  );
  return { organizationId, facilityId: main.rows[0]!.id, otherFacilityId: annex.rows[0]!.id };
}

let passwordHash: Promise<string> | undefined;

/** Creates a staff user in the tenant with system roles, optionally scoped to a facility. */
export async function createStaff(
  pool: Pool,
  tenant: Tenant,
  email: string,
  roles: Array<string | { role: string; facilityId: string }>,
  options: { platformAdmin?: boolean } = {},
): Promise<string> {
  passwordHash ??= hashPassword(PASSWORD);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO app_user (email, display_name, password_hash, is_platform_admin) VALUES ($1, $1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [email, await passwordHash, options.platformAdmin ?? false],
  );
  const userId = user.rows[0]!.id;
  await pool.query(`INSERT INTO organization_membership (organization_id, user_id) VALUES ($1, $2)`, [tenant.organizationId, userId]);
  for (const entry of roles) {
    const { role, facilityId } = typeof entry === "string" ? { role: entry, facilityId: null } : entry;
    await pool.query(
      `INSERT INTO role_assignment (organization_id, user_id, role_id, facility_id)
       SELECT $1, $2, id, $4 FROM role WHERE key = $3 AND is_system`,
      [tenant.organizationId, userId, role, facilityId],
    );
  }
  return userId;
}

export async function login(ctx: TestContext, email: string, organizationId?: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await ctx.http().post("/api/v1/auth/login").send({ email, password: PASSWORD, organizationId });
  if (response.status !== 200 || !response.body.accessToken) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

/** Authorization and facility headers for a request. */
export function as(token: string, facilityId?: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...(facilityId ? { "x-facility-id": facilityId } : {}) };
}

export async function auditRows(
  pool: Pool,
  where = "TRUE",
  params: unknown[] = [],
): Promise<
  Array<{
    action: string;
    outcome: string;
    reason: string | null;
    actor_type: string;
    patient_id: string | null;
    metadata: Record<string, unknown> | null;
  }>
> {
  const result = await pool.query(
    `SELECT action, outcome, reason, actor_type, patient_id, metadata FROM audit_event WHERE ${where} ORDER BY occurred_at, id`,
    params,
  );
  return result.rows;
}

export const juan = {
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: "Santos",
  sex: "male",
  birthDate: "1980-03-04",
  contacts: [{ system: "mobile", value: "0917 123 4567" }],
  addresses: [{ barangay: "Poblacion", cityMunicipality: "Makati City", province: "Metro Manila", postalCode: "1210" }],
  identifiers: [{ type: "philhealth_pin", value: "12-345678901-2" }],
};

/** Runs the outbox relay until no events are pending (the relay is not started in tests). */
export async function drainEvents(ctx: TestContext): Promise<number> {
  return ctx.app.get(OutboxRelay).drain();
}

/** A local calendar date (Asia/Manila) `days` from now. */
export function manilaDate(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + days * 86_400_000));
}

/** Creates a staff user and links them to a practitioner record. Returns ids. */
export async function createClinician(
  ctx: TestContext,
  tenant: Tenant,
  email: string,
  roles: Array<string | { role: string; facilityId: string }>,
  profession = "physician",
): Promise<{ userId: string; practitionerId: string }> {
  const userId = await createStaff(ctx.pool, tenant, email, roles);
  const result = await ctx.pool.query<{ id: string }>(
    `INSERT INTO practitioner (organization_id, user_id, display_name, profession, license_number) VALUES ($1, $2, $3, $4, 'PRC-0000000') RETURNING id`,
    [tenant.organizationId, userId, `Dr. ${email.split("@")[0]}`, profession],
  );
  return { userId, practitionerId: result.rows[0]!.id };
}

/** Supertest parser that keeps a binary body (PDFs) as a Buffer. */
export const binary: Parameters<import("supertest").Test["parse"]>[0] = (res: unknown, done: (error: Error | null, body: Buffer) => void) => {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
  stream.on("error", (error: Error) => done(error, Buffer.alloc(0)));
};
