import { NextResponse, type NextRequest } from "next/server";
import { withScope } from "@/lib/db/client";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { activeThresholdVersion } from "@/lib/repos/thresholds";

export const runtime = "nodejs";

/** The tenant's active rules (thresholds + photo policy) so the driver app evaluates exactly like the server. */
export async function GET(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const scope = { actor: "driver" as const, tenantId: session.tenantId, driverId: session.driverId };
  const v = await withScope(scope, (tx) => activeThresholdVersion(tx, session.tenantId));
  return NextResponse.json({ ok: true, rules: { id: v.id, version: v.version, tenantSpecific: !!v.tenant_id, config: v.config } });
}
