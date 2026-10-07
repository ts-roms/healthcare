import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, API_URL, E2E_DATABASE_URL, ORGANIZATION_CODE, PORTAL_PORT, PORTAL_URL, REDIS_URL, STAFF_PORT, STAFF_URL } from "./support/env";

/**
 * Critical journeys (CLAUDE.md §31) against the built applications: the API (apps/api/dist), the staff app and the
 * patient portal (`next start`), on their own ports and a database recreated for every run. `nx e2e e2e` builds the
 * three applications first. Journeys run one after another: they share the seeded clinic and its schedule.
 */
const root = "../..";
const ci = Boolean(process.env.CI);

// Explicit values for everything the servers read, so a developer's .env (which Nx loads into tasks) cannot point the
// run at the development database.
const apiEnv = {
  NODE_ENV: "development",
  PORT: String(API_PORT),
  LOG_LEVEL: "warn",
  DATABASE_URL: E2E_DATABASE_URL,
  REDIS_URL,
  JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CORS_ORIGINS: `${STAFF_URL},${PORTAL_URL}`,
  // MyHealth's address: the relying party of its passkeys (journey 7) and the links in its emails.
  PORTAL_BASE_URL: PORTAL_URL,
  TRUST_PROXY: "true",
};
// No video server: online consultations run without video (the clinician can call the patient's number). Nx loads a
// developer's .env into this process, and the web servers inherit it, so drop any video settings from it.
for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) delete process.env[key];

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: ci ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Manila",
    locale: "en-PH",
  },
  projects: [
    { name: "setup", testMatch: /setup\.setup\.ts/ },
    { name: "journeys", testMatch: /\.journey\.ts/, dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    {
      name: "api",
      // Started from apps/e2e so the API's dotenv finds no .env file: only the values below apply.
      command: "node -r @swc-node/register support/prepare-database.ts && node ../api/dist/main.js",
      cwd: ".",
      url: `${API_URL}/health/live`,
      env: apiEnv,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "staff",
      // E2E_STAFF_DEV=1 runs the staff app with `next dev` (full React error messages while debugging a journey).
      command: `pnpm exec next ${process.env.E2E_STAFF_DEV ? "dev" : "start"} --port ${STAFF_PORT}`,
      cwd: `${root}/apps/staff`,
      url: `${STAFF_URL}/login`,
      env: { API_BASE_URL: API_URL, REALTIME_URL: `http://localhost:${API_PORT}/realtime` },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      name: "portal",
      command: `pnpm exec next start --port ${PORTAL_PORT}`,
      cwd: `${root}/apps/portal`,
      url: `${PORTAL_URL}/login`,
      env: { API_BASE_URL: API_URL, PORTAL_ORGANIZATION_CODE: ORGANIZATION_CODE },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
