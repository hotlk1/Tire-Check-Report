import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authFallbackTarget, canonicalHost } from "@/lib/auth/redirects";

/**
 * Request proxy (runs before routing):
 *  1. Canonical host: production deployments answer on several Vercel aliases;
 *     cookies (Supabase session, PKCE verifier, driver session) are per host,
 *     so every alias is redirected to the project's production URL.
 *  2. Supabase Site-URL fallback: when Auth cannot honour our redirect it sends
 *     the PKCE `code` (or an error) to the site root; route it into /auth/callback.
 *  3. Session refresh: Server Components cannot write cookies, so an expired
 *     Supabase access token is refreshed here for admin routes.
 */
export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;

  const canonical = canonicalHost({
    vercelEnv: process.env.VERCEL_ENV,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    configuredUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (canonical && host !== canonical && !url.pathname.startsWith("/api/")) {
    const target = new URL(url.pathname + url.search, `https://${canonical}`);
    return NextResponse.redirect(target, 308);
  }

  const fallback = authFallbackTarget(new URL(url.pathname + url.search, `${url.protocol}//${host}`));
  if (fallback) return NextResponse.redirect(fallback, 303);

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return refreshSupabaseSession(req);
  return NextResponse.next();
}

async function refreshSupabaseSession(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  // getUser() validates the token with Supabase Auth and rotates it when expired.
  await supabase.auth.getUser().catch(() => null);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)"],
};
