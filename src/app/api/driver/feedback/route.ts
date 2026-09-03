import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { createDriverFeedback } from "@/lib/repos/feedback";
import { rateLimitHit } from "@/lib/db/client";

export const runtime = "nodejs";
const APP_VERSION = "driver-checkpoint-2";

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  message: z.string().max(4000).nullable().optional(),
  page: z.string().max(200).nullable().optional(),
  locale: z.string().max(8).nullable().optional(),
});

/** Driver feedback (rating 1–5 + optional text). Requires a driver session; light rate limit per driver. */
export async function POST(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "validation" }, { status: 400 });
  if (!(await rateLimitHit(`feedback:${session.driverId}`, 20, 3600))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const { id } = await createDriverFeedback(
    { actor: "driver", tenantId: session.tenantId, driverId: session.driverId },
    { rating: parsed.data.rating, message: parsed.data.message?.trim() || null, page: parsed.data.page ?? null, appVersion: APP_VERSION, userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null, locale: parsed.data.locale ?? null },
  );
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
