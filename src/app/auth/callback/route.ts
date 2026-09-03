import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirects";
import { userHasAdminAccess } from "@/lib/repos/admin/users";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase Auth redirect target for magic links / invitations.
 *
 *  - PKCE flow: `?code=` is exchanged for a session (the verifier cookie was set
 *    on this host when the link was requested).
 *  - Token-hash flow: `?token_hash=&type=` (email templates using {{ .TokenHash }}).
 *  - GoTrue errors (`error_code`, e.g. otp_expired) land on the login page with a message.
 *
 * A valid Supabase session alone does not grant admin access: the user must be a
 * super admin or hold a membership, otherwise the session is discarded.
 */
export async function GET(req: NextRequest) {
  const e = env();
  const sp = req.nextUrl.searchParams;
  const next = safeNextPath(sp.get("next"));
  const loginWith = (error: string) => NextResponse.redirect(new URL(`/admin/login?error=${error}`, req.url), 303);

  if (sp.get("error_code") || sp.get("error")) return loginWith("link");
  const code = sp.get("code");
  const tokenHash = sp.get("token_hash");
  const otpType = (sp.get("type") ?? "magiclink") as EmailOtpType;
  if ((!code && !tokenHash) || !e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) return loginWith("link");

  // Cookies written by the auth client are buffered and copied onto whichever redirect we return.
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) pending.push({ name: c.name, value: c.value, options: c.options ?? {} });
      },
    },
  });
  const withCookies = (res: NextResponse) => {
    for (const c of pending) res.cookies.set(c.name, c.value, c.options);
    return res;
  };

  const result = code ? await supabase.auth.exchangeCodeForSession(code) : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType });
  if (result.error || !result.data.user) {
    console.warn("[auth/callback] sign-in failed:", result.error?.message ?? "no user");
    return withCookies(loginWith("link"));
  }

  const allowed = await userHasAdminAccess({ id: result.data.user.id, email: result.data.user.email ?? "", name: (result.data.user.user_metadata?.full_name as string | undefined) ?? null });
  if (!allowed) {
    await supabase.auth.signOut();
    return withCookies(loginWith("no_access"));
  }
  return withCookies(NextResponse.redirect(new URL(next, req.url), 303));
}
