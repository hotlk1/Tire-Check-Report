import { env, tier } from "@/lib/env";

/**
 * Cloudflare Turnstile server-side verification.
 * - Production: TURNSTILE_SECRET_KEY is required (env() enforces it) and a
 *   missing/invalid token fails closed.
 * - Development without a secret: the check is skipped and logged loudly so
 *   nobody mistakes it for a working CAPTCHA.
 */
export async function verifyTurnstile(token: string | null | undefined, remoteIp?: string | null): Promise<{ ok: boolean; reason?: string }> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (tier() === "production") return { ok: false, reason: "captcha_not_configured" };
    console.warn(`[turnstile] ${tier().toUpperCase()}: TURNSTILE_SECRET_KEY not set – CAPTCHA check skipped`);
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "missing_token" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return data.success ? { ok: true } : { ok: false, reason: (data["error-codes"] ?? []).join(",") || "invalid" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "verify_failed" };
  }
}

export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}
