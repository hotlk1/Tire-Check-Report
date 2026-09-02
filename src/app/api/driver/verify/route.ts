import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitHit } from "@/lib/db/client";
import { normalizeUsPhone } from "@/lib/driver/phone";
import { setDriverCookie, signDriverSession } from "@/lib/driver/session";
import { findActiveDriverByPhone } from "@/lib/repos/drivers";
import { findActiveTenantBySlug } from "@/lib/repos/tenants";
import { clientIp } from "@/lib/security/request";
import { verifyTurnstile } from "@/lib/security/turnstile";

export const runtime = "nodejs";

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  phone: z.string().min(1).max(32),
  turnstileToken: z.string().max(4096).optional().nullable(),
});

/**
 * Public driver identification (spec §2).
 *  - Turnstile CAPTCHA (fails closed in production)
 *  - rate limited per IP and per tenant link
 *  - exact match only; the response never reveals whether the tenant or the
 *    number exists ("denied" in every non-match case)
 *  - constant-ish response shape/timing: we always do the same work order.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "denied" }, { status: 400 });
  const { tenant, phone, turnstileToken } = parsed.data;

  const [ipOk, tenantOk] = await Promise.all([
    rateLimitHit(`verify:ip:${ip}`, 10, 10 * 60),
    rateLimitHit(`verify:tenant:${tenant.toLowerCase()}`, 300, 10 * 60),
  ]);
  if (!ipOk || !tenantOk) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) return NextResponse.json({ ok: false, error: "captcha" }, { status: 403 });

  const digits = normalizeUsPhone(phone);
  const tenantRow = await findActiveTenantBySlug(tenant.toLowerCase());
  const driver = digits && tenantRow ? await findActiveDriverByPhone(tenantRow.id, digits) : null;

  if (!tenantRow || !driver) {
    // Small uniform delay to blunt timing differences between "no tenant", "no driver" and "inactive".
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ ok: false, error: "denied" }, { status: 403 });
  }

  const { token, session } = await signDriverSession({
    tenantId: tenantRow.id,
    tenantSlug: tenantRow.slug,
    tenantName: tenantRow.name,
    driverId: driver.id,
    driverName: driver.full_name,
  });
  const res = NextResponse.json({
    ok: true,
    driver: { id: driver.id, name: driver.full_name, locale: driver.locale },
    tenant: { slug: tenantRow.slug, name: tenantRow.name },
    expiresAt: session.expiresAt,
  });
  setDriverCookie(res, token);
  return res;
}
