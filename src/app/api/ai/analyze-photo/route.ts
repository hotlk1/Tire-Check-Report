import { NextResponse, type NextRequest } from "next/server";
import { photoAnalysisProvider } from "@/lib/ai";
import { rateLimitHit } from "@/lib/db/client";
import { driverSessionFromRequest } from "@/lib/driver/session";

export const runtime = "nodejs";

/**
 * Assistive photo analysis (spec §9). Accepts a multipart image, returns a
 * suggestion. Never authoritative – the client shows it as
 * "AI estimate: 5/32 – 87% confidence" and the driver accepts or ignores it.
 */
export async function POST(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const provider = photoAnalysisProvider();
  if (!provider) return NextResponse.json({ ok: true, available: false });

  if (!(await rateLimitHit(`ai:driver:${session.driverId}`, 120, 60 * 60))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  const tireNumber = Number(form?.get("tireNumber") ?? "") || undefined;
  try {
    const result = await provider.analyze({ bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, context: { tireNumber } });
    return NextResponse.json({ ok: true, available: true, result });
  } catch (e) {
    console.error("[ai] analysis failed", e);
    return NextResponse.json({ ok: true, available: true, result: null, error: "analysis_failed" });
  }
}
