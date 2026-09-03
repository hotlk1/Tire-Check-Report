"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { assetBase } from "@/lib/equipment/paths";
import { templateByKey } from "@/lib/equipment/templates";
import type { ComponentKind, EquipmentConfig } from "@/lib/equipment/types";
import { createAsset, updateAsset } from "@/lib/repos/admin/assets";
import { publishConfiguration } from "@/lib/repos/equipment";

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

export async function saveAssetAction(type: ComponentKind, id: string | null, form: FormData) {
  const session = await requireAdmin();
  const input = inputFrom(form);
  const base = assetBase(type);
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

export async function setAssetStatusAction(type: ComponentKind, id: string, form: FormData) {
  const session = await requireAdmin();
  const status = form.get("status") === "inactive" ? "inactive" : "active";
  await updateAsset(session.scope, id, { status }, label(session));
  const base = assetBase(type);
  revalidatePath(base);
  redirect(`${base}/${id}`);
}

/**
 * Publishes a new configuration version for an asset. The editor posts the
 * configuration as JSON (`config`) built from a template plus edits; the
 * server validates structure and kind and audits the change.
 */
export async function publishConfigurationAction(type: ComponentKind, id: string, form: FormData) {
  const session = await requireAdmin();
  const base = assetBase(type);
  if (!canConfigure(session)) redirect(`${base}/${id}?error=not_allowed#configuration`);
  let config: EquipmentConfig;
  try {
    const raw = String(form.get("config") ?? "");
    const template = String(form.get("template") ?? "");
    config = raw ? (JSON.parse(raw) as EquipmentConfig) : templateByKey(template)!.config;
  } catch {
    redirect(`${base}/${id}?error=invalid_config#configuration`);
  }
  try {
    await publishConfiguration(session.scope, id, config, String(form.get("note") ?? "").trim() || null, label(session));
  } catch (e) {
    redirect(`${base}/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "invalid_config")}#configuration`);
  }
  revalidatePath(`${base}/${id}`);
  redirect(`${base}/${id}?saved=1#configuration`);
}
