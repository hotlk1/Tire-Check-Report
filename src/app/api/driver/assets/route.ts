import { NextResponse, type NextRequest } from "next/server";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { searchAssets } from "@/lib/repos/assets";

export const runtime = "nodejs";

/** Tenant-scoped asset search for the equipment picker. Requires a driver session. */
export async function GET(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const type = req.nextUrl.searchParams.get("type");
  if (type !== "truck" && type !== "trailer") return NextResponse.json({ ok: false, error: "bad_type" }, { status: 400 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 40);
  const assets = await searchAssets({ actor: "driver", tenantId: session.tenantId, driverId: session.driverId }, type, q, 25);
  return NextResponse.json({ ok: true, assets });
}
