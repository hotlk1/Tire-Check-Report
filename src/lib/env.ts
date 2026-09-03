import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Application-level configuration only. Tenant integration credentials are
 * stored encrypted in the database, never in environment variables.
 */
/**
 * Normalize hosting-provided variables before validation so the app runs on
 * Vercel with the Supabase integration without hand-copied secrets:
 *  - DATABASE_URL            ← POSTGRES_URL | POSTGRES_PRISMA_URL | POSTGRES_URL_NON_POOLING
 *  - NEXT_PUBLIC_SUPABASE_URL ← SUPABASE_URL
 *  - anon/publishable key    ← NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | SUPABASE_PUBLISHABLE_KEY | *_ANON_KEY
 *  - secret key              ← SUPABASE_SECRET_KEY | SUPABASE_SERVICE_ROLE_KEY (legacy)
 *  - APP_ENV                 ← VERCEL_ENV + VERCEL_GIT_COMMIT_REF (production only from `main`)
 *  - DRIVER_SESSION_SECRET   ← derived from the Supabase secret / JWT secret when not set explicitly
 */
/**
 * First available integration-managed Postgres URL. All three point at the same
 * database: POSTGRES_URL (transaction pooler), POSTGRES_PRISMA_URL (same, with a
 * pgbouncer flag that postgres.js must not receive) and POSTGRES_URL_NON_POOLING
 * (session pooler). Parameters postgres.js does not understand are stripped.
 */
function pickPostgresUrl(e: NodeJS.ProcessEnv): string | undefined {
  const raw = e.POSTGRES_URL || e.POSTGRES_PRISMA_URL || e.POSTGRES_URL_NON_POOLING;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    for (const k of ["pgbouncer", "connection_limit", "pool_timeout", "supa"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

function normalizeHostEnv(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...raw };
  e.DATABASE_URL ||= pickPostgresUrl(e);
  e.NEXT_PUBLIC_SUPABASE_URL ||= e.SUPABASE_URL;
  e.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || e.SUPABASE_PUBLISHABLE_KEY || e.SUPABASE_ANON_KEY;
  e.SUPABASE_SECRET_KEY ||= e.SUPABASE_SERVICE_ROLE_KEY;
  if (!e.APP_ENV && e.VERCEL_ENV) {
    // Only a production deployment built from `main` is the production tier; any other
    // branch (e.g. the staging project's branch) is staging even if Vercel labels it production.
    const ref = e.VERCEL_GIT_COMMIT_REF ?? "";
    e.APP_ENV = e.VERCEL_ENV === "production" && (ref === "" || ref === "main") ? "production" : "staging";
  }
  if (!e.DRIVER_SESSION_SECRET) {
    const seed = e.SUPABASE_JWT_SECRET || e.SUPABASE_SECRET_KEY;
    if (seed) e.DRIVER_SESSION_SECRET = createHash("sha256").update(`tire-check:driver-session:${seed}`).digest("hex");
  }
  return e;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Deployment tier, independent of NODE_ENV. `staging` runs a production
   * build against real Supabase but may relax the CAPTCHA requirement (with a
   * loud warning) while Turnstile keys are not configured. `production` never
   * relaxes anything.
   */
  APP_ENV: z.enum(["development", "staging", "production"]).optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DRIVER_SESSION_SECRET: z.string().min(32, "DRIVER_SESSION_SECRET must be at least 32 characters"),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "APP_ENCRYPTION_KEY must be 32 bytes hex (64 chars)")
    .optional()
    .or(z.literal("")),
  TURNSTILE_SECRET_KEY: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal("")),
  /** Server-only privileged key: new `sb_secret_…` key, or the legacy service role JWT. Never sent to the browser. */
  SUPABASE_SECRET_KEY: z.string().optional().or(z.literal("")),
  SUPABASE_STORAGE_BUCKET: z.string().default("inspection-photos"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal("")),
  /** Explicit canonical origin (https://…). Defaults to Vercel's production URL on production deployments, else the request host. */
  NEXT_PUBLIC_APP_URL: z.string().optional().or(z.literal("")),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(normalizeHostEnv(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  const tier = appTier(cached);
  if (tier === "production") {
    if (!cached.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY is required in production");
    if (!cached.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  if (tier === "staging" && !cached.TURNSTILE_SECRET_KEY) {
    console.warn("[env] STAGING: TURNSTILE_SECRET_KEY not set – CAPTCHA disabled on this staging deployment");
  }
  return cached;
}

function appTier(e: Env): "development" | "staging" | "production" {
  if (e.APP_ENV) return e.APP_ENV;
  return e.NODE_ENV === "production" ? "production" : "development";
}

/** Effective deployment tier: APP_ENV if set, otherwise derived from NODE_ENV. */
export const tier = () => appTier(env());
export const isProduction = () => tier() === "production";
