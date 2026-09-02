import { NextResponse, type NextRequest } from "next/server";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { inspectionSubmissionSchema } from "@/lib/inspection/schema";
import { createInspection, SubmissionRejected } from "@/lib/repos/inspections";
import { clientIp } from "@/lib/security/request";

export const runtime = "nodejs";

/** Submit a completed inspection (metadata + tire readings). Photos follow via /api/inspections/{id}/photos. */
export async function POST(req: NextRequest) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = inspectionSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "validation", details: parsed.error.issues.slice(0, 10) }, { status: 400 });
  }

  try {
    const result = await createInspection(
      { actor: "driver", tenantId: session.tenantId, driverId: session.driverId },
      parsed.data,
      { ip: clientIp(req), driverName: session.driverName },
    );
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof SubmissionRejected) {
      return NextResponse.json({ ok: false, error: e.code, issues: e.issues, message: e.message }, { status: 422 });
    }
    console.error("[inspections] submit failed", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
