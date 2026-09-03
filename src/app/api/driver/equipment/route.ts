import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { driverEquipment } from "@/lib/repos/equipment";

export const runtime = "nodejs";

/** Configuration + mounted tires of one asset, for the driver's equipment step. Requires a driver session. */
export async function GET(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const assetId = req.nextUrl.searchParams.get("assetId") ?? "";
  if (!z.string().uuid().safeParse(assetId).success) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const equipment = await driverEquipment({ actor: "driver", tenantId: session.tenantId, driverId: session.driverId }, assetId);
  if (!equipment) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, equipment });
}
