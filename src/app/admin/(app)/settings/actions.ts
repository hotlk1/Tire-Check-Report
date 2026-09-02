"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { publishThresholdVersion, updateTenantSettings } from "@/lib/repos/admin/thresholds";
import type { ThresholdConfig } from "@/lib/tires/thresholds";

function n(form: FormData, key: string): number {
  return Number(String(form.get(key) ?? "").trim());
}

export async function publishThresholdsAction(form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/settings?error=not_allowed");
  const cls = (k: "steer" | "drive" | "trailer") => ({ redMax: n(form, `tread.${k}.redMax`), yellowMax: n(form, `tread.${k}.yellowMax`) });
  const psi = (k: "steer" | "drive" | "trailer") => ({ redBelow: n(form, `psi.${k}.redBelow`), yellowBelow: n(form, `psi.${k}.yellowBelow`), redAbove: n(form, `psi.${k}.redAbove`) });
  const config: ThresholdConfig = {
    schemaVersion: 1,
    tread32: { steer: cls("steer"), drive: cls("drive"), trailer: cls("trailer") },
    psi: { steer: psi("steer"), drive: psi("drive"), trailer: psi("trailer") },
    axle: { psiDiffYellow: n(form, "axle.psiDiffYellow"), psiDiffRed: n(form, "axle.psiDiffRed"), dualTreadMismatch: n(form, "axle.dualTreadMismatch") },
  };
  try {
    await publishThresholdVersion(session.scope, config, String(form.get("note") ?? "").trim() || null, session.user.name ?? session.user.email);
  } catch (e) {
    redirect(`/admin/settings?error=${encodeURIComponent(e instanceof Error ? e.message : "invalid")}`);
  }
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}

export async function saveGeneralAction(form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/settings?error=not_allowed");
  const days = Math.max(1, Math.min(365, Number(form.get("inspectionDueDays")) || 7));
  await updateTenantSettings(session.scope, { inspectionDueDays: days }, session.user.name ?? session.user.email);
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}
