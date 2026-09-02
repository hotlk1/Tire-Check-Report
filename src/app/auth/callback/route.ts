import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Supabase Auth redirect target for magic links / invitations (PKCE flow).
 * Exchanges the code for a session cookie, then continues to the admin app.
 */
export async function GET(req: NextRequest) {
  const e = env();
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/admin";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const res = NextResponse.redirect(new URL(safeNext, req.url));
  if (!code || !e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.redirect(new URL("/admin/login?error=link", req.url));
  }
  const supabase = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/admin/login?error=link", req.url));
  return res;
}
