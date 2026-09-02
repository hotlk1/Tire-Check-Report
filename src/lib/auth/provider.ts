import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Admin identity providers.
 *
 *  - SupabaseAuthProvider (production): email/password sessions via
 *    @supabase/ssr cookies; invitations through the Auth admin API.
 *  - DevAuthProvider (DEVELOPMENT ONLY): a signed cookie naming one of the
 *    seeded users. Refused in production, logged loudly elsewhere.
 *
 * Both resolve to a stable user id that matches `users.id`.
 */
export interface Identity {
  id: string;
  email: string;
  name?: string | null;
}

export interface AuthProvider {
  readonly name: "supabase" | "dev";
  getIdentity(): Promise<Identity | null>;
  signInWithPassword(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Email a one-time sign-in link (Supabase magic link). Dev provider signs in directly. */
  sendMagicLink(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): Promise<void>;
  /** Creates (or finds) the auth user for an email and returns its id. */
  inviteUser(email: string): Promise<{ id: string; email: string }>;
}

class SupabaseAuthProvider implements AuthProvider {
  readonly name = "supabase" as const;
  private async client() {
    const e = env();
    const store = await cookies();
    return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const c of list) store.set(c.name, c.value, c.options);
          } catch {
            /* called from a Server Component: cookies are refreshed by proxy.ts */
          }
        },
      },
    });
  }
  async getIdentity() {
    const supabase = await this.client();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return null;
    return { id: data.user.id, email: data.user.email, name: (data.user.user_metadata?.full_name as string | undefined) ?? null };
  }
  async signInWithPassword(email: string, password: string) {
    const supabase = await this.client();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false as const, error: error.message } : { ok: true as const };
  }
  async sendMagicLink(email: string, redirectTo: string) {
    const supabase = await this.client();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
    return error ? { ok: false as const, error: error.message } : { ok: true as const };
  }
  async signOut() {
    const supabase = await this.client();
    await supabase.auth.signOut();
  }
  async inviteUser(email: string) {
    const e = env();
    if (!e.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY required to invite users");
    const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) {
      // Already registered → look the user up.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const found = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) return { id: found.id, email };
      throw new Error(error.message);
    }
    return { id: data.user.id, email };
  }
}

const DEV_COOKIE = "tc_admin_dev";

class DevAuthProvider implements AuthProvider {
  readonly name = "dev" as const;
  private secret() {
    return new TextEncoder().encode(env().DRIVER_SESSION_SECRET);
  }
  async getIdentity() {
    const store = await cookies();
    const token = store.get(DEV_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret(), { audience: "admin-dev" });
      return { id: String(payload.sub), email: String(payload.email), name: (payload.name as string | null) ?? null };
    } catch {
      return null;
    }
  }
  /** Dev login: password is ignored; the email must belong to a seeded user (checked by the caller). */
  async signInWithPassword(email: string) {
    const { findUserByEmailUnscoped } = await import("@/lib/repos/admin/users");
    const user = await findUserByEmailUnscoped(email);
    if (!user) return { ok: false as const, error: "unknown_user" };
    const token = await new SignJWT({ email: user.email, name: user.full_name })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setAudience("admin-dev")
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(this.secret());
    const store = await cookies();
    store.set({ name: DEV_COOKIE, value: token, httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
    return { ok: true as const };
  }
  async sendMagicLink(email: string) {
    return this.signInWithPassword(email);
  }
  async signOut() {
    const store = await cookies();
    store.set({ name: DEV_COOKIE, value: "", path: "/", maxAge: 0 });
  }
  async inviteUser(email: string) {
    return { id: crypto.randomUUID(), email };
  }
}

let cached: AuthProvider | null = null;

export function authProvider(): AuthProvider {
  if (cached) return cached;
  const e = env();
  if (e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    cached = new SupabaseAuthProvider();
  } else {
    if (e.NODE_ENV === "production") throw new Error("Supabase Auth is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    console.warn("[auth] DEV MODE: Supabase Auth not configured – using the development login (any seeded user, no password)");
    cached = new DevAuthProvider();
  }
  return cached;
}
