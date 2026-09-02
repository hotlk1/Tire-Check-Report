import { z } from "zod";

/**
 * Application-level configuration only. Tenant integration credentials are
 * stored encrypted in the database, never in environment variables.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal("")),
  SUPABASE_STORAGE_BUCKET: z.string().default("inspection-photos"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal("")),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  if (cached.NODE_ENV === "production") {
    if (!cached.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY is required in production");
    if (!cached.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
