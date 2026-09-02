import { NextResponse, type NextRequest } from "next/server";
import { clearDriverCookie, driverSessionFromRequest } from "@/lib/driver/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({
    ok: true,
    driver: { id: session.driverId, name: session.driverName },
    tenant: { slug: session.tenantSlug, name: session.tenantName },
    expiresAt: session.expiresAt,
  });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearDriverCookie(res);
  return res;
}
