import { NextResponse, type NextRequest } from "next/server";
import { listBrands, listModels, listSizes, listVariants } from "@/lib/catalog/repo";
import { driverSessionFromRequest } from "@/lib/driver/session";

export const runtime = "nodejs";

/**
 * Cascading catalog lookups for the driver tire sheet:
 *   ?level=brands[&q=]            → brands
 *   ?level=models&brand=<id>[&q=] → models of a brand
 *   ?level=variants&model=<id>    → sizes / SKUs of a model
 *   ?level=sizes[&q=]             → distinct sizes (size-first path)
 *   ?level=search&q=              → free search across brand / model / size
 * Read-only; RLS returns shared rows plus the driver's tenant custom rows.
 */
export async function GET(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const scope = { actor: "driver" as const, tenantId: session.tenantId, driverId: session.driverId };
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").slice(0, 40);
  const level = p.get("level") ?? "brands";
  try {
    switch (level) {
      case "brands":
        return NextResponse.json({ ok: true, brands: await listBrands(scope, { q }) });
      case "models":
        return NextResponse.json({ ok: true, models: await listModels(scope, { brandId: p.get("brand"), q }) });
      case "variants":
        return NextResponse.json({ ok: true, variants: await listVariants(scope, { modelId: p.get("model"), brandId: p.get("brand"), size: p.get("size"), q, limit: 100 }) });
      case "sizes":
        return NextResponse.json({ ok: true, sizes: await listSizes(scope, q) });
      case "search":
        return NextResponse.json({ ok: true, variants: await listVariants(scope, { q, limit: 40 }) });
      default:
        return NextResponse.json({ ok: false, error: "bad_level" }, { status: 400 });
    }
  } catch (e) {
    console.error("[catalog] lookup failed", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
