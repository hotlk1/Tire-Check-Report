"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveBrand, saveModel, saveVariant } from "@/lib/catalog/repo";
import type { TireApplication } from "@/lib/catalog/provider";
import { canConfigure, requireAdmin } from "@/lib/auth/session";

const PATH = "/admin/tires/catalog";

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function app(v: FormDataEntryValue | null): TireApplication {
  const s = String(v ?? "");
  return (["steer", "drive", "trailer", "all_position"].includes(s) ? s : "all_position") as TireApplication;
}
function status(v: FormDataEntryValue | null): "active" | "discontinued" {
  return v === "discontinued" ? "discontinued" : "active";
}

/** Shared catalog rows (tenant NULL) need a super admin; tenant custom rows need a tenant admin. RLS enforces both. */
async function ctx(form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect(`${PATH}?error=not_allowed`);
  const shared = form.get("scope") === "shared";
  if (shared && !session.user.isSuperAdmin) redirect(`${PATH}?error=not_allowed`);
  return { session, tenantId: shared ? null : session.scope.tenantId, label: session.user.name ?? session.user.email };
}

export async function saveBrandAction(id: string | null, form: FormData) {
  const { session, tenantId, label } = await ctx(form);
  try {
    await saveBrand(session.scope, tenantId, id, { name: String(form.get("name") ?? ""), country: String(form.get("country") ?? "") || null, website: String(form.get("website") ?? "") || null, status: status(form.get("status")) }, label);
  } catch (e) {
    redirect(`${PATH}?tab=brands&error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?tab=brands&saved=1`);
}

export async function saveModelAction(id: string | null, form: FormData) {
  const { session, tenantId, label } = await ctx(form);
  try {
    await saveModel(session.scope, tenantId, id, { brand_id: String(form.get("brand_id") ?? ""), name: String(form.get("name") ?? ""), application: app(form.get("application")), category: String(form.get("category") ?? "") || null, status: status(form.get("status")) }, label);
  } catch (e) {
    redirect(`${PATH}?tab=models&error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?tab=models&saved=1`);
}

export async function saveVariantAction(id: string | null, form: FormData) {
  const { session, tenantId, label } = await ctx(form);
  try {
    await saveVariant(
      session.scope,
      tenantId,
      id,
      {
        model_id: String(form.get("model_id") ?? ""),
        size: String(form.get("size") ?? ""),
        part_number: String(form.get("part_number") ?? "") || null,
        application: app(form.get("application")),
        load_range: String(form.get("load_range") ?? "") || null,
        ply_rating: num(form.get("ply_rating")),
        load_index_single: num(form.get("load_index_single")),
        load_index_dual: num(form.get("load_index_dual")),
        speed_rating: String(form.get("speed_rating") ?? "") || null,
        max_cold_psi: num(form.get("max_cold_psi")),
        original_tread_32nds: num(form.get("original_tread_32nds")),
        rim_size: String(form.get("rim_size") ?? "") || null,
        status: status(form.get("status")),
      },
      label,
    );
  } catch (e) {
    redirect(`${PATH}?tab=variants&error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?tab=variants&saved=1`);
}
