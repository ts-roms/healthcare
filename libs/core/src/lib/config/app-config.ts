import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const appConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
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
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("ap-southeast-1"),
  S3_BUCKET: z.string().default("healthcare-documents"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Healthcare Platform <no-reply@localhost>"),
  // Telemedicine video (LiveKit). Leave unset to run online consultations without video (phone fallback).
  // LIVEKIT_URL is the WebSocket URL browsers connect to, e.g. wss://video.example.ph.
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const APP_CONFIG = Symbol("APP_CONFIG");

/** Parses and validates configuration. Fails fast with every problem listed. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = appConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}
