/**
 * Pure helpers for the admin sign-in redirect flow. Kept free of Next.js
 * imports so they can be unit-tested and shared by proxy.ts, the auth
 * callback route and the server actions.
 */

/** Only same-origin, absolute paths are accepted as a post-login destination. */
export function safeNextPath(next: string | null | undefined, fallback = "/admin"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(next) || next.includes("://")) return fallback;
  // Never bounce back into the auth endpoints themselves.
  if (next.startsWith("/auth/") || next.startsWith("/admin/login")) return fallback;
  return next;
}

export interface OriginInputs {
  /** VERCEL_ENV of the running deployment (production | preview | development), if any. */
  vercelEnv?: string;
  /** VERCEL_PROJECT_PRODUCTION_URL: the project's production domain (no scheme). */
  productionUrl?: string;
  /** Explicit override (NEXT_PUBLIC_APP_URL), full origin. */
  configuredUrl?: string;
  /** Request host / proto as seen by the server (after Vercel's forwarding headers). */
  requestHost?: string | null;
  requestProto?: string | null;
}

function stripOrigin(u: string): string | null {
  try {
    const url = new URL(u.includes("://") ? u : `https://${u}`);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin every absolute URL we hand to third parties (magic links,
 * QR codes) must use. Production deployments have a single canonical host;
 * previews and local development use the request host.
 */
export function resolveAppOrigin(i: OriginInputs): string {
  const configured = i.configuredUrl ? stripOrigin(i.configuredUrl) : null;
  if (configured) return configured;
  if (i.vercelEnv === "production" && i.productionUrl) {
    const o = stripOrigin(i.productionUrl);
    if (o) return o;
  }
  const host = i.requestHost || "localhost:3000";
  const proto = i.requestProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Host (no scheme) of the canonical origin when this deployment has one, else null. */
export function canonicalHost(i: Pick<OriginInputs, "vercelEnv" | "productionUrl" | "configuredUrl">): string | null {
  const configured = i.configuredUrl ? stripOrigin(i.configuredUrl) : null;
  if (configured) return new URL(configured).host;
  if (i.vercelEnv === "production" && i.productionUrl) {
    const o = stripOrigin(i.productionUrl);
    if (o) return new URL(o).host;
  }
  return null;
}

/**
 * Supabase Auth falls back to the project's Site URL when the requested
 * redirect is not on its allow list, delivering `?code=` (PKCE) or the
 * `error_code`/`error_description` pair to the site root instead of our
 * callback. Detects that situation so proxy.ts can route it into
 * /auth/callback on the same host (where the PKCE verifier cookie lives).
 */
export function authFallbackTarget(url: URL): string | null {
  const p = url.pathname;
  if (p === "/auth/callback" || p.startsWith("/api/") || p.startsWith("/_next/")) return null;
  if (!(p === "/" || p === "/admin" || p.startsWith("/admin/"))) return null;
  const sp = url.searchParams;
  const hasAuthParams = sp.has("code") || sp.has("token_hash") || sp.has("error_code") || sp.has("error_description");
  if (!hasAuthParams) return null;
  const target = new URL("/auth/callback", url.origin);
  for (const k of ["code", "token_hash", "type", "error", "error_code", "error_description"]) {
    const v = sp.get(k);
    if (v) target.searchParams.set(k, v);
  }
  target.searchParams.set("next", safeNextPath(sp.get("next") ?? (p.startsWith("/admin") ? p : "/admin")));
  return target.toString();
}
