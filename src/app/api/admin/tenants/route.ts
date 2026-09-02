import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { withScope } from "@/lib/db/client";

export const runtime = "nodejs";

/** Tenants the signed-in admin may switch to (super admins: all active tenants). */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!session.user.isSuperAdmin) {
    return NextResponse.json({ ok: true, tenants: session.memberships.map((m) => ({ slug: m.tenantSlug, name: m.tenantName })) });
  }
  const tenants = await withScope({ actor: "super_admin", userId: session.user.id }, (tx) => tx<{ slug: string; name: string }[]>`select slug, name from tenants where status = 'active' order by name`);
  return NextResponse.json({ ok: true, tenants });
}
