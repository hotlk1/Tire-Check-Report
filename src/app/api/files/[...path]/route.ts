import { NextResponse, type NextRequest } from "next/server";
import { storage, verifyLocalSignature } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serves files from the LOCAL development storage provider using HMAC-signed
 * URLs. With Supabase Storage configured, signed URLs point at Supabase and
 * this route is never used.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  if (storage().name !== "local") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { path } = await ctx.params;
  const objectPath = path.join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyLocalSignature(objectPath, exp, sig)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const file = await storage().get(objectPath);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), { headers: { "content-type": file.contentType, "cache-control": "private, max-age=3600" } });
}
