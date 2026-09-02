import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { driverSessionFromRequest } from "@/lib/driver/session";
import { addPhoto } from "@/lib/repos/inspections";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const fieldsSchema = z.object({
  clientPhotoId: z.string().uuid(),
  tireNumber: z.coerce.number().int().min(1).max(20).nullable().optional(),
  takenAt: z.string().datetime({ offset: true }).nullable().optional(),
  width: z.coerce.number().int().positive().nullable().optional(),
  height: z.coerce.number().int().positive().nullable().optional(),
});

/** Multipart photo upload for an inspection owned by the current driver session. Idempotent on clientPhotoId. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/inspections/[id]/photos">) {
  const session = await driverSessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "bad_form" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "bad_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });

  const fields = fieldsSchema.safeParse({
    clientPhotoId: form.get("clientPhotoId"),
    tireNumber: form.get("tireNumber") || null,
    takenAt: form.get("takenAt") || null,
    width: form.get("width") || null,
    height: form.get("height") || null,
  });
  if (!fields.success) return NextResponse.json({ ok: false, error: "validation" }, { status: 400 });

  try {
    const result = await addPhoto(
      { actor: "driver", tenantId: session.tenantId, driverId: session.driverId },
      {
        inspectionId: id,
        tireNumber: fields.data.tireNumber ?? null,
        clientPhotoId: fields.data.clientPhotoId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        takenAt: fields.data.takenAt ?? null,
        width: fields.data.width ?? null,
        height: fields.data.height ?? null,
      },
    );
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof Error && e.message === "inspection_not_found") {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    console.error("[photos] upload failed", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
