"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createAsset, updateAsset } from "@/lib/repos/admin/assets";

function label(s: Awaited<ReturnType<typeof requireAdmin>>) {
  return s.user.name ?? s.user.email;
}

function inputFrom(form: FormData) {
  const year = String(form.get("year") ?? "").trim();
  return {
    unit_number: String(form.get("unit_number") ?? "").trim(),
    vin: String(form.get("vin") ?? "").trim() || null,
    make: String(form.get("make") ?? "").trim() || null,
    model: String(form.get("model") ?? "").trim() || null,
    year: year ? Number(year) : null,
    license_plate: String(form.get("license_plate") ?? "").trim() || null,
    status: (form.get("status") === "inactive" ? "inactive" : "active") as "active" | "inactive",
  };
}

export async function saveAssetAction(type: "truck" | "trailer", id: string | null, form: FormData) {
  const session = await requireAdmin();
  const input = inputFrom(form);
  const base = type === "truck" ? "/admin/trucks" : "/admin/trailers";
  if (!input.unit_number) redirect(`${base}?error=unit_required`);
  try {
    const assetId = id ? (await updateAsset(session.scope, id, input, label(session)), id) : await createAsset(session.scope, type, input, label(session));
    revalidatePath(base);
    redirect(`${base}/${assetId}?saved=1`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("duplicate")) redirect(`${base}?error=duplicate`);
    throw e;
  }
}

export async function setAssetStatusAction(type: "truck" | "trailer", id: string, form: FormData) {
  const session = await requireAdmin();
  const status = form.get("status") === "inactive" ? "inactive" : "active";
  await updateAsset(session.scope, id, { status }, label(session));
  const base = type === "truck" ? "/admin/trucks" : "/admin/trailers";
  revalidatePath(base);
  redirect(`${base}/${id}`);
}
