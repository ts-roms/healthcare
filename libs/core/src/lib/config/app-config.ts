import { z } from "zod";
import { ENCRYPTION_KEY_ID_PATTERN, type Keyring } from "../security/crypto";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

/** A JSON object of name → absolute URI, given as one environment variable. */
const jsonUriMap = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON object" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.string().url()));

const isAes256Key = (value: string) => Buffer.from(value, "base64").length === 32;

/** A JSON object of key id → 32-byte base64 key, given as one environment variable. */
const jsonKeyMap = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON object of key id → key" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .record(z.string(), z.string().refine(isAes256Key, "each key must be 32 bytes, base64-encoded"))
      .refine((keys) => Object.keys(keys).length > 0, "list at least one key")
      .refine((keys) => Object.keys(keys).every((id) => ENCRYPTION_KEY_ID_PATTERN.test(id)), "key ids are 1–40 letters, digits, '_' or '-'"),
  );

const appConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3333),
    // Workers have no HTTP server; with a port set they answer GET /live and /ready for the platform's health probes.
    HEALTH_PORT: z.coerce.number().int().positive().optional(),
    LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    // Row-level security (migration 0111, docs/runbooks/database-roles.md): what a query without an organization or
    // platform context may do. observe: everything (its call site is logged); enforce: nothing; off: no organization
    // rule at all (rollback). Only effective when DATABASE_URL is the restricted application role.
    DATABASE_RLS_MODE: z.enum(["off", "observe", "enforce"]).default("observe"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    MFA_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, "base64").length === 32, "MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: booleanString.default(false),
    // Screens new passwords against the Pwned Passwords range API (docs/security/access-control.md); when on, a password
    // that cannot be checked is refused. Unset: on in production, off elsewhere (development, tests and CI may be offline).
    PASSWORD_BREACH_CHECK: booleanString.optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("ap-southeast-1"),
    S3_BUCKET: z.string().default("healthcare-documents"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString.default(false),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default("Healthcare Platform <no-reply@localhost>"),
    // Public address of the patient portal (MyHealth), e.g. https://myhealth.example.ph. Password-reset emails link to it;
    // without it no reset email is sent.
    // Audit trail retention (docs/runbooks/audit-retention.md): whole months an archived audit partition must be past
    // before a platform administrator may remove it. Unset: nothing is ever removed. The period is the organization's
    // compliance decision; the platform sets none.
    AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(1).max(1200).optional(),
    PORTAL_BASE_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    // Public address of the staff app, e.g. https://staff.example.ph. Staff password-reset emails link to it; without it no
    // reset email is sent.
    STAFF_BASE_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    // Web Push to patients' browsers (docs/domains/notification.md, "Push"). A VAPID key pair (`npx web-push generate-vapid-keys`) and
    // a contact address (mailto: or https:); all three or none. Without them MyHealth does not offer push.
    VAPID_PUBLIC_KEY: z.string().min(40).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, "VAPID_SUBJECT is a mailto: or https: address")
      .optional(),
    // Push to the MyHealth mobile app through the Expo push service (docs/architecture/mobile-app.md). No account is needed to
    // send; EXPO_ACCESS_TOKEN is only for Expo projects with "enhanced push security" turned on. Off unless enabled.
    EXPO_PUSH_ENABLED: booleanString.default(false),
    EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
    // Malware scanning of uploaded documents through clamd's INSTREAM protocol (docs/domains/documents.md). Unset: files
    // are recorded as not scanned (the readiness probe and a production start-up warning say so).
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
    // Telemedicine video (LiveKit). Leave unset to run online consultations without video (phone fallback).
    // LIVEKIT_URL is the WebSocket URL browsers connect to, e.g. wss://video.example.ph.
    LIVEKIT_URL: z.string().url().optional(),
    LIVEKIT_API_KEY: z.string().min(1).optional(),
    LIVEKIT_API_SECRET: z.string().min(1).optional(),
    // Online payment through PayMongo's hosted checkout (docs/domains/billing.md). Leave PAYMONGO_SECRET_KEY unset to offer
    // no online payment. PAYMONGO_WEBHOOK_SECRET is the signing secret of the webhook registered for
    // checkout_session.payment.paid; PAYMONGO_PAYMENT_METHODS lists the payment method types enabled on the merchant account.
    PAYMONGO_SECRET_KEY: z
      .string()
      .regex(/^sk_(test|live)_[A-Za-z0-9]+$/, "PAYMONGO_SECRET_KEY must be a PayMongo secret key (sk_test_… or sk_live_…)")
      .optional(),
    PAYMONGO_WEBHOOK_SECRET: z.string().min(1).optional(),
    PAYMONGO_PAYMENT_METHODS: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(["card", "gcash", "grab_pay", "paymaya", "billease", "dob", "qrph"])).min(1))
      .optional(),
    PAYMONGO_API_BASE: z.string().url().optional(),
    // FHIR R4 read interface (docs/interoperability/fhir.md). FHIR_BASE_URL is the public base used in Bundle links,
    // e.g. https://api.example.ph/api/v1/fhir/r4 (defaults to the request's own URL). FHIR_IDENTIFIER_BASE namespaces the
    // platform's own identifier systems (the organization code is appended). FHIR_IDENTIFIER_SYSTEMS / FHIR_CODE_SYSTEMS are
    // JSON maps from internal identifier types / coding keys to official URIs, once those are confirmed.
    FHIR_BASE_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    FHIR_IDENTIFIER_BASE: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    FHIR_IDENTIFIER_SYSTEMS: jsonUriMap.optional(),
    FHIR_CODE_SYSTEMS: jsonUriMap.optional(),
    // Encrypts prepared integration payloads (e.g. a PhilHealth claim) between the API and the integration worker
    // (docs/architecture/integration-worker.md). Keys are 32 bytes, base64. Either one key (INTEGRATION_PAYLOAD_KEY, key id
    // "default") or, to rotate without draining the queue, a key ring: INTEGRATION_PAYLOAD_KEYS as a JSON object of
    // key id → key, and INTEGRATION_PAYLOAD_KEY_ID naming the key new payloads are sealed with (both may be combined with
    // INTEGRATION_PAYLOAD_KEY). Required in production; elsewhere MFA_ENCRYPTION_KEY (key id "development") is used when
    // none is set.
    INTEGRATION_PAYLOAD_KEY: z.string().refine(isAes256Key, "INTEGRATION_PAYLOAD_KEY must be 32 bytes, base64-encoded").optional(),
    INTEGRATION_PAYLOAD_KEYS: jsonKeyMap.optional(),
    INTEGRATION_PAYLOAD_KEY_ID: z.string().regex(ENCRYPTION_KEY_ID_PATTERN, "a key id from INTEGRATION_PAYLOAD_KEYS").optional(),
  })
  .superRefine((config, ctx) => {
    const vapid = [config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY, config.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["VAPID_PUBLIC_KEY"],
        message: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together, or none of them",
      });
    }
    const problem = integrationKeyringProblem(config);
    if (problem) ctx.addIssue({ code: "custom", path: [problem.path], message: problem.message });
    if (config.PAYMONGO_SECRET_KEY && (!config.PAYMONGO_WEBHOOK_SECRET || !config.PAYMONGO_PAYMENT_METHODS)) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMONGO_SECRET_KEY"],
        message: "PAYMONGO_SECRET_KEY needs PAYMONGO_WEBHOOK_SECRET and PAYMONGO_PAYMENT_METHODS",
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;

/** Whether new passwords are screened against breached passwords: `PASSWORD_BREACH_CHECK`, else only in production. */
export function passwordBreachCheckEnabled(config: Pick<AppConfig, "NODE_ENV" | "PASSWORD_BREACH_CHECK">): boolean {
  return config.PASSWORD_BREACH_CHECK ?? config.NODE_ENV === "production";
}

export const APP_CONFIG = Symbol("APP_CONFIG");

type IntegrationKeyConfig = Pick<
  AppConfig,
  "NODE_ENV" | "MFA_ENCRYPTION_KEY" | "INTEGRATION_PAYLOAD_KEY" | "INTEGRATION_PAYLOAD_KEYS" | "INTEGRATION_PAYLOAD_KEY_ID"
>;

/** Key id of INTEGRATION_PAYLOAD_KEY (the single-key configuration). */
export const DEFAULT_INTEGRATION_KEY_ID = "default";
/** Key id of the MFA_ENCRYPTION_KEY fallback (development and tests only). */
export const DEVELOPMENT_INTEGRATION_KEY_ID = "development";

function integrationKeys(config: IntegrationKeyConfig): Map<string, string> {
  const keys = new Map(Object.entries(config.INTEGRATION_PAYLOAD_KEYS ?? {}));
  if (config.INTEGRATION_PAYLOAD_KEY && !keys.has(DEFAULT_INTEGRATION_KEY_ID)) keys.set(DEFAULT_INTEGRATION_KEY_ID, config.INTEGRATION_PAYLOAD_KEY);
  return keys;
}

function currentIntegrationKeyId(config: IntegrationKeyConfig, keys: Map<string, string>): string | undefined {
  if (config.INTEGRATION_PAYLOAD_KEY_ID) return config.INTEGRATION_PAYLOAD_KEY_ID;
  return keys.size === 1 ? [...keys.keys()][0] : undefined;
}

function integrationKeyringProblem(config: IntegrationKeyConfig): { path: string; message: string } | undefined {
  const keys = integrationKeys(config);
  const listed = config.INTEGRATION_PAYLOAD_KEYS?.[DEFAULT_INTEGRATION_KEY_ID];
  if (listed && config.INTEGRATION_PAYLOAD_KEY && listed !== config.INTEGRATION_PAYLOAD_KEY) {
    return {
      path: "INTEGRATION_PAYLOAD_KEYS",
      message: `key id "${DEFAULT_INTEGRATION_KEY_ID}" is INTEGRATION_PAYLOAD_KEY's; list it with the same key or use another id`,
    };
  }
  if (keys.size === 0) {
    if (config.INTEGRATION_PAYLOAD_KEY_ID) return { path: "INTEGRATION_PAYLOAD_KEY_ID", message: "names a key, but no integration payload key is configured" };
    if (config.NODE_ENV === "production") {
      return {
        path: "INTEGRATION_PAYLOAD_KEY",
        message: "INTEGRATION_PAYLOAD_KEY (or INTEGRATION_PAYLOAD_KEYS) is required in production (a key separate from MFA_ENCRYPTION_KEY)",
      };
    }
    return undefined;
  }
  const current = currentIntegrationKeyId(config, keys);
  if (!current) return { path: "INTEGRATION_PAYLOAD_KEY_ID", message: "is required when several integration payload keys are configured" };
  if (!keys.has(current)) return { path: "INTEGRATION_PAYLOAD_KEY_ID", message: `"${current}" is not a configured integration payload key id` };
  if (config.NODE_ENV === "production") {
    const mfa = Buffer.from(config.MFA_ENCRYPTION_KEY, "base64");
    const reused = [...keys].find(([, key]) => Buffer.from(key, "base64").equals(mfa));
    if (reused) return { path: "INTEGRATION_PAYLOAD_KEYS", message: `key "${reused[0]}" is MFA_ENCRYPTION_KEY; use a separate key in production` };
  }
  return undefined;
}

/**
 * The integration payload key ring (configuration already validated): payloads are sealed with the current key and
 * opened with whichever listed key they name. Outside production, with no key configured, MFA_ENCRYPTION_KEY stands in.
 */
export function integrationPayloadKeyring(config: IntegrationKeyConfig): Keyring {
  const keys = integrationKeys(config);
  if (keys.size === 0) {
    if (config.NODE_ENV === "production") throw new Error("INTEGRATION_PAYLOAD_KEY is required in production");
    return { currentKeyId: DEVELOPMENT_INTEGRATION_KEY_ID, keys: new Map([[DEVELOPMENT_INTEGRATION_KEY_ID, config.MFA_ENCRYPTION_KEY]]) };
  }
  const currentKeyId = currentIntegrationKeyId(config, keys);
  if (!currentKeyId || !keys.has(currentKeyId)) throw new Error("INTEGRATION_PAYLOAD_KEY_ID does not name a configured key");
  return { currentKeyId, keys };
}

/**
 * Settings that mean "not configured" when blank. Hosting dashboards (Railway, Docker env files) commonly leave a variable
 * defined but empty; for these an empty value is the same as an absent one. Deliberately not listed: NODE_ENV, REDIS_URL,
 * secrets and keys that are required or change security behaviour, so a blank one still fails at start-up.
 */
const BLANK_MEANS_UNSET = [
  "HEALTH_PORT",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "SMTP_URL",
  "PORTAL_BASE_URL",
  "STAFF_BASE_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "EXPO_PUSH_ENABLED",
  "EXPO_ACCESS_TOKEN",
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "CLAMAV_TIMEOUT_MS",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "PAYMONGO_SECRET_KEY",
  "PAYMONGO_WEBHOOK_SECRET",
  "PAYMONGO_PAYMENT_METHODS",
  "PAYMONGO_API_BASE",
  "FHIR_BASE_URL",
  "FHIR_IDENTIFIER_BASE",
  "FHIR_IDENTIFIER_SYSTEMS",
  "FHIR_CODE_SYSTEMS",
] as const;

function withoutBlankOptionals(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  for (const name of BLANK_MEANS_UNSET) if (cleaned[name]?.trim() === "") delete cleaned[name];
  return cleaned;
}

/** Parses and validates configuration. Fails fast with every problem listed. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = appConfigSchema.safeParse(withoutBlankOptionals(env));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}

/** The Nest log levels enabled by `LOG_LEVEL` (that level and every more severe one). */
export function levelsFrom(level: AppConfig["LOG_LEVEL"]): Array<"error" | "warn" | "log" | "debug" | "verbose"> {
  const order = ["error", "warn", "log", "debug", "verbose"] as const;
  return order.slice(0, order.indexOf(level) + 1);
}
